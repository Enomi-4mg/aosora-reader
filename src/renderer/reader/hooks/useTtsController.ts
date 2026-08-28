import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Book } from '@shared/model/document'
import { comparePositions, type BookIndex, type TextPosition, type TextRange } from '@shared/model/position'
import type { ReaderSettings } from '@shared/model/settings'

export type TtsState = 'idle' | 'playing' | 'paused'

interface Sentence {
  text: string
  range: TextRange
}

export interface TtsController {
  state: TtsState
  currentRange: TextRange | null
  supported: boolean
  play(): void
  pause(): void
  resume(): void
  stop(): void
  nextSentence(): void
  previousSentence(): void
}

export function useTtsController(args: {
  book: Book | null
  index: BookIndex | null
  position: TextPosition | null
  settings: ReaderSettings
  onFollow: (position: TextPosition) => void
}): TtsController {
  const { book, index, position, settings, onFollow } = args
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const [state, setState] = useState<TtsState>('idle')
  const [cursor, setCursor] = useState(-1)
  const sentences = useMemo(() => book ? sentenceRanges(book) : [], [book])
  const cursorRef = useRef(cursor)
  cursorRef.current = cursor
  const stateRef = useRef(state)
  stateRef.current = state

  /**
   * いま有効な発話の世代。
   *
   * speechSynthesis.cancel() は読み上げ中の発話にも end / error を投げる。
   * 文送りは「cancel してから次を speak する」ので、古い発話のイベントが
   * 新しい発話の開始後に届き、idle に戻したり2文先へ飛ばしたりしていた。
   * 世代が変わっている発話のイベントは、置き換え済みとして捨てる。
   */
  const generation = useRef(0)

  const speak = useCallback((at: number) => {
    const token = ++generation.current
    if (!supported || !sentences[at]) { setState('idle'); setCursor(-1); return }
    const sentence = sentences[at]!
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(sentence.text)
    const voice = window.speechSynthesis.getVoices().find((item) => item.voiceURI === settings.ttsVoice)
    if (voice) utterance.voice = voice
    utterance.rate = settings.ttsRate
    utterance.pitch = settings.ttsPitch
    utterance.volume = settings.ttsVolume
    utterance.lang = voice?.lang ?? 'ja-JP'
    utterance.onend = () => {
      if (generation.current !== token) return
      if (stateRef.current === 'playing') speak(at + 1)
    }
    utterance.onerror = () => {
      if (generation.current !== token) return
      setState('idle')
      setCursor(-1)
    }
    setCursor(at)
    setState('playing')
    onFollow(sentence.range.start)
    window.speechSynthesis.speak(utterance)
  }, [sentences, settings.ttsVoice, settings.ttsRate, settings.ttsPitch, settings.ttsVolume, supported, onFollow])

  const positionCursor = useCallback((): number => {
    if (!position || !index) return 0
    const found = sentences.findIndex((sentence) => comparePositions(index, sentence.range.end, position) >= 0)
    return found < 0 ? Math.max(0, sentences.length - 1) : found
  }, [position, index, sentences])

  /** 文送りの基点。停止中は本文の現在位置から数える(先頭からではなく)。 */
  const baseCursor = useCallback(
    (): number => (cursorRef.current >= 0 ? cursorRef.current : positionCursor()),
    [positionCursor]
  )

  const stop = useCallback(() => {
    generation.current++
    if (supported) window.speechSynthesis.cancel()
    setState('idle')
    setCursor(-1)
  }, [supported])

  useEffect(() => stop, [book?.id])

  return {
    state,
    currentRange: cursor >= 0 ? sentences[cursor]?.range ?? null : null,
    supported,
    play: () => speak(baseCursor()),
    pause: () => { if (supported) window.speechSynthesis.pause(); setState('paused') },
    resume: () => { if (supported) window.speechSynthesis.resume(); setState('playing') },
    stop,
    nextSentence: () => speak(Math.min(sentences.length - 1, baseCursor() + 1)),
    previousSentence: () => speak(Math.max(0, baseCursor() - 1))
  }
}

export function sentenceRanges(book: Book): Sentence[] {
  const out: Sentence[] = []
  for (const chapter of book.chapters) {
    for (const block of chapter.blocks) {
      const pattern = /[^。！？!?\n]+[。！？!?]?/g
      for (const match of block.plainText.matchAll(pattern)) {
        const start = match.index ?? 0
        const text = match[0].trim()
        if (!text) continue
        const leading = match[0].indexOf(text)
        const offset = start + Math.max(0, leading)
        out.push({
          text,
          range: {
            start: { bookId: book.id, chapterId: chapter.id, blockId: block.id, offset },
            end: { bookId: book.id, chapterId: chapter.id, blockId: block.id, offset: offset + text.length }
          }
        })
      }
    }
  }
  return out
}
