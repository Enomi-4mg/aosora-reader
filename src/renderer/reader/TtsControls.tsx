import type { JSX } from 'react'
import type { TtsController } from './hooks/useTtsController'

export function TtsControls({ controller }: { controller: TtsController }): JSX.Element {
  if (!controller.supported) return <span className="muted small" title="この環境では読み上げを利用できません">読上不可</span>
  return (
    <div className="tts-controls" role="group" aria-label="読み上げ">
      <button className="ghost" onClick={controller.previousSentence} aria-label="前の文">‹</button>
      {controller.state === 'playing'
        ? <button className="ghost" onClick={controller.pause} aria-label="一時停止">停止</button>
        : <button className="ghost" onClick={controller.state === 'paused' ? controller.resume : controller.play} aria-label="読み上げ開始">読上</button>}
      <button className="ghost" onClick={controller.nextSentence} aria-label="次の文">›</button>
      {controller.state !== 'idle' && <button className="ghost" onClick={controller.stop} aria-label="読み上げ終了">×</button>}
    </div>
  )
}
