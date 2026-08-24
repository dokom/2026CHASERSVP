/**
 * The CHASE wordmark (public/chaselogo.svg, 178x67). Sized by height so it
 * keeps its 8:3 proportion; the intrinsic width/height attributes reserve
 * the box before the SVG arrives, so nothing shifts when it does.
 */
const HEIGHTS = { sm: 'h-7', md: 'h-9', lg: 'h-14' } as const

export function BrandMark({ size = 'md', className = '' }: { size?: keyof typeof HEIGHTS; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a static SVG in
    // public/; next/image would only add a wrapper and a blur placeholder.
    <img
      src="/chaselogo.svg"
      alt="CHASE"
      width={178}
      height={67}
      className={`${HEIGHTS[size]} w-auto ${className}`}
      data-brand-mark
    />
  )
}
