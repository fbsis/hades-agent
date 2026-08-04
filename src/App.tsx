import React, { Suspense, lazy, useEffect } from 'react'

const CommandBar = lazy(() => import('./components/CommandBar'))
const MiniChat = lazy(() => import('./components/MiniChat'))
const VoiceRecorder = lazy(() => import('./components/VoiceRecorder'))
const Susurro = lazy(() => import('./components/Susurro'))
const SuggestionsPopup = lazy(() => import('./components/SuggestionsPopup'))
const Splash = lazy(() => import('./components/Splash'))
const Settings = lazy(() => import('./components/Settings'))
const FloatingHead = lazy(() => import('./components/FloatingHead'))

const App: React.FC = () => {
  const urlParams = new URLSearchParams(globalThis.location.search)
  const windowType = urlParams.get('window')

  useEffect(() => {
    console.log(
      `%c[METIS RENDERER] Window mounted: ${windowType || 'command'}`,
      'color: var(--color-primary-light); font-weight: bold; font-size: 14px;'
    )
    console.log('[METIS RENDERER] Location:', globalThis.location.href)
    console.log('[METIS RENDERER] Document visibilityState:', document.visibilityState)
  }, [windowType])

  let content: React.ReactNode = <CommandBar />

  if (windowType === 'splash') content = <Splash />
  if (windowType === 'chat') content = <MiniChat />
  if (windowType === 'voice') content = <VoiceRecorder />
  if (windowType === 'susurro') content = <Susurro />
  if (windowType === 'suggestions') content = <SuggestionsPopup />
  if (windowType === 'settings') content = <Settings />
  if (windowType === 'floating-head') content = <FloatingHead />

  return <Suspense fallback={null}>{content}</Suspense>
}

export default App
