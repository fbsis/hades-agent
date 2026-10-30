import Foundation
import Darwin

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data(("Metis: " + message + "\n").utf8))
    exit(1)
}
let args = CommandLine.arguments
if args.count != 3 { fail("configuração ou ação ausente") }
let action = args[2]
if !["translate", "proofread", "rewrite"].contains(action) { fail("ação não permitida") }
guard let configData = try? Data(contentsOf: URL(fileURLWithPath: args[1])),
      let config = (try? JSONSerialization.jsonObject(with: configData)) as? [String: Any],
      let socketPath = config["socket"] as? String,
      let token = config["token"] as? String,
      let bundle = config["bundle"] as? String,
      let launchArgs = config["launchArgs"] as? [String] else { fail("abra o Metis e configure as ações de texto") }
var input = Data()
while true {
    let chunk = FileHandle.standardInput.readData(ofLength: 8192)
    if chunk.isEmpty { break }
    input.append(chunk)
    if input.count > 131072 { fail("selecione um trecho menor, até 30.000 caracteres") }
}
guard let text = String(data: input, encoding: .utf8),
      !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      text.unicodeScalars.count <= 30000 else { fail("selecione texto, até 30.000 caracteres") }
func connectSocket() -> Int32? {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    if fd < 0 { return nil }
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    let bytes = Array(socketPath.utf8CString)
    guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else { close(fd); return nil }
    withUnsafeMutableBytes(of: &address.sun_path) { destination in
        bytes.withUnsafeBytes { source in destination.copyBytes(from: source) }
    }
    let result = withUnsafePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
    }
    if result != 0 { close(fd); return nil }
    var timeout = timeval(tv_sec: 90, tv_usec: 0)
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
    var noSignal: Int32 = 1
    setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size))
    return fd
}
var connection = connectSocket()
if connection == nil {
    let launcher = Process()
    launcher.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    launcher.arguments = ["-n", "-g", "-a", bundle, "--args"] + launchArgs + ["--metis-service-launch"]
    launcher.standardOutput = FileHandle.nullDevice
    launcher.standardError = FileHandle.nullDevice
    do { try launcher.run(); launcher.waitUntilExit() } catch { fail("não foi possível abrir o Metis") }
    // Configuration/token are stable across launches; only the local socket needs to become ready.
    for _ in 0..<80 {
        usleep(125000)
        connection = connectSocket()
        if connection != nil { break }
    }
}
guard let fd = connection else { fail("Metis indisponível; abra o app e tente novamente") }
defer { close(fd) }
let request = try JSONSerialization.data(withJSONObject: ["version": 1, "token": token, "action": action, "text": text]) + Data([10])
var written = 0
while written < request.count {
    let count = request.withUnsafeBytes { Darwin.write(fd, $0.baseAddress!.advanced(by: written), request.count - written) }
    if count <= 0 { fail("falha ao enviar ao Metis") }
    written += count
}
var response = Data()
var buffer = [UInt8](repeating: 0, count: 8192)
while !response.contains(10) {
    let count = Darwin.read(fd, &buffer, buffer.count)
    if count <= 0 { fail("a transformação não concluiu; o texto original foi mantido") }
    response.append(contentsOf: buffer.prefix(count))
    if response.count > 262144 { fail("resultado acima do limite") }
}
guard let body = (try? JSONSerialization.jsonObject(with: response)) as? [String: Any],
      body["ok"] as? Bool == true,
      let output = body["text"] as? String,
      !output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
    fail("não foi possível transformar; abra o Metis e confira a chave OpenAI/configuração")
}
// Only transformed text goes to Automator stdout. No credentials, prompts or logs.
FileHandle.standardOutput.write(Data(output.utf8))
