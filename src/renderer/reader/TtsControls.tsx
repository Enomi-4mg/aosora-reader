import type { JSX } from 'react'
import {
  BackwardIcon,
  ForwardIcon,
  PauseIcon,
  PlayIcon,
  SpeakerXMarkIcon,
  StopIcon
} from '@heroicons/react/24/outline'
import { ToolbarButton } from '../components/ToolbarButton'
import type { TtsController } from './hooks/useTtsController'

export function TtsControls({ controller }: { controller: TtsController }): JSX.Element {
  if (!controller.supported) {
    return (
      <span className="tool-button muted" data-tip="この環境では読み上げを利用できません" aria-hidden="true">
        <SpeakerXMarkIcon className="icon" />
      </span>
    )
  }
  return (
    <div className="tts-controls" role="group" aria-label="読み上げ">
      <ToolbarButton
        label="前の文"
        icon={<BackwardIcon className="icon" />}
        onClick={controller.previousSentence}
      />
      {controller.state === 'playing' ? (
        <ToolbarButton
          label="一時停止"
          icon={<PauseIcon className="icon" />}
          onClick={controller.pause}
        />
      ) : (
        <ToolbarButton
          label={controller.state === 'paused' ? '読み上げを再開' : '読み上げ'}
          icon={<PlayIcon className="icon" />}
          onClick={controller.state === 'paused' ? controller.resume : controller.play}
        />
      )}
      <ToolbarButton
        label="次の文"
        icon={<ForwardIcon className="icon" />}
        onClick={controller.nextSentence}
      />
      {controller.state !== 'idle' && (
        <ToolbarButton
          label="読み上げ終了"
          icon={<StopIcon className="icon" />}
          onClick={controller.stop}
        />
      )}
    </div>
  )
}
