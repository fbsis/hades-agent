import {describe,it,expect} from 'vitest';
import state from './workspaceWindowState.js';
describe('Metis workspace windows',()=>{
 it('accepts only HTTPS or loopback HTTP without secrets',()=>{expect(state.endpoint('http://127.0.0.1:8765')).toBe('http://127.0.0.1:8765');expect(state.endpoint('https://work.home.fbsis.com')).toBe('https://work.home.fbsis.com');for(const u of ['http://192.168.1.2','https://user:secret@example.com','file:///tmp/app','https://example.com?token=x'])expect(()=>state.endpoint(u)).toThrow();});
 it('keeps company in URL and never puts a capability in it',()=>{const url=new URL(state.windowURL('https://work.home.fbsis.com','globo','notes'));expect(url.searchParams.get('desktop_workspace')).toBe('globo');expect(url.hash).toBe('#notes');expect(url.searchParams.get('compact')).toBe('1');expect(()=>state.windowURL('https://work.home.fbsis.com','globo','full','https://evil.test')).toThrow();});
 it('restores bounds inside the surviving display',()=>{expect(state.bounds({x:9999,y:-100,width:9000,height:9000},{x:0,y:0,width:1440,height:900},'notes')).toEqual({x:0,y:0,width:1440,height:900});});
 it('isolates browser sessions by workspace',()=>{expect(state.partition('globo')).not.toBe(state.partition('qad'));expect(state.key('globo','full')).toBe('globo:full');expect(()=>state.key('../bad','full')).toThrow();});
});
