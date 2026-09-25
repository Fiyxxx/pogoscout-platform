import type { CSSProperties, ReactNode } from 'react'
import type { ImageRecord } from '../api/types'

/** A ground capture cropped to the landing area (lower part of the frame). */
export function Capture({
  image,
  alt,
  style,
  children,
  emptyText = 'No capture yet',
}: {
  image: ImageRecord | null
  alt: string
  style?: CSSProperties
  children?: ReactNode
  emptyText?: string
}) {
  return (
    <div style={{ position: 'relative', overflow: 'hidden', border: '1px solid #2a2a28', background: 'var(--surface)', ...style }}>
      {image ? (
        // The frame is taller than the box and anchored at the bottom, so the upper part of the
        // capture (horizon and frame header) is cropped off at any aspect ratio.
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '140%' }}>
          <img src={image.url} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center bottom', display: 'block' }} />
        </div>
      ) : (
        <div className="empty" style={{ fontSize: 13 }}>
          {emptyText}
        </div>
      )}
      {children}
    </div>
  )
}

export function Overlay({ children, corner }: { children: ReactNode; corner: 'bl' | 'br' | 'tr' }) {
  const pos: CSSProperties =
    corner === 'bl' ? { left: 8, bottom: 8 } : corner === 'br' ? { right: 8, bottom: 8 } : { right: 8, top: 8 }
  return (
    <span className="mono" style={{ position: 'absolute', ...pos, fontSize: 11, padding: '3px 6px', background: 'rgba(10,10,10,.85)' }}>
      {children}
    </span>
  )
}
