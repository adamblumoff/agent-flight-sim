import { forwardRef } from 'react'
import { flightPanel } from './flight-ui'
import { cn } from '../lib/utils'

export const FlightCompass = forwardRef<HTMLDivElement>(function FlightCompass(_, ref) {
  return (
    <section className={cn(flightPanel, 'pointer-events-none absolute bottom-32 left-5 z-[8] grid min-h-[116px] w-[286px] grid-cols-[96px_1fr] gap-x-3 gap-y-2.5 rounded-[15px] bg-[linear-gradient(145deg,rgb(20_24_20/91%),rgb(11_15_12/86%))] p-2.5 max-[760px]:bottom-[calc(49vh+24px)] max-[760px]:left-3 max-[480px]:bottom-[calc(52vh+24px)] max-[480px]:w-[min(286px,calc(100vw-24px))]')} ref={ref} aria-label="Flight compass. Route pending.">
      <div className="relative size-24 overflow-hidden rounded-full border border-[#f4efde]/15 bg-[radial-gradient(circle_at_center,rgb(16_21_17/94%)_0_55%,transparent_56%),repeating-conic-gradient(from_-1deg,rgb(244_239_222/30%)_0_1deg,transparent_1deg_15deg),#0a0f0c] shadow-[inset_0_0_0_5px_rgb(244_239_222/3%),inset_0_0_24px_rgb(0_0_0/52%)]" aria-hidden="true">
        <div className="absolute inset-0 will-change-transform [&_span]:absolute [&_span]:font-mono [&_span]:text-[8px] [&_span]:font-semibold [&_span]:text-[#f4efde]/75" data-compass-card>
          <span className="left-1/2 top-2 -translate-x-1/2 text-[#8bc49b]!">N</span>
          <span className="right-[9px] top-1/2 -translate-y-1/2">E</span>
          <span className="bottom-2 left-1/2 -translate-x-1/2">S</span>
          <span className="left-[9px] top-1/2 -translate-y-1/2">W</span>
        </div>
        <div className="absolute inset-0 opacity-0 will-change-transform data-[active]:opacity-100" data-course-needle><i className="absolute left-1/2 top-[5px] h-[39px] w-0.5 -translate-x-1/2 rounded-sm bg-[#8bc49b] shadow-[0_0_8px_rgb(139_196_155/44%)]" /></div>
        <div className="absolute inset-0 will-change-transform" data-wind-needle><i className="absolute left-1/2 top-3 h-[26px] w-px -translate-x-1/2 bg-sky-300/75" /></div>
        <div className="absolute left-1/2 top-1/2 h-5 w-[34px] -translate-x-1/2 -translate-y-1/2">
          <i className="absolute left-0 top-[9px] h-0.5 w-[34px] rounded-sm bg-[#f4efde]" />
          <i className="absolute left-4 top-0 h-5 w-0.5 rounded-sm bg-[#f4efde]" />
          <i className="absolute left-3.5 top-0 size-1.5 rounded-t-full bg-[#f4efde]" />
          <i className="absolute bottom-0.5 left-3 h-0.5 w-2.5 rounded-sm bg-[#f4efde]" />
        </div>
      </div>
      <div className="grid min-w-0 content-center gap-2 [&>div]:grid [&>div]:min-w-0 [&>div]:gap-0.5 [&_span]:font-mono [&_span]:text-[7px] [&_span]:font-semibold [&_span]:uppercase [&_span]:tracking-[0.09em] [&_span]:text-[#f4efde]/45 [&_strong]:overflow-hidden [&_strong]:text-ellipsis [&_strong]:whitespace-nowrap [&_strong]:font-mono [&_strong]:text-[9px] [&_strong]:font-semibold [&_strong]:text-[#f4efde]/90">
        <div><span>Heading</span><strong data-heading-value>000°</strong></div>
        <div><span>Next fix</span><strong className="text-[#8bc49b]!" data-course-value>Route pending</strong></div>
        <div><span>Wind from</span><strong className="text-sky-300!" data-wind-value>000° · 0 kt</strong></div>
      </div>
      <div className="col-span-full flex justify-end gap-3 pr-0.5 font-mono text-[7px] font-semibold uppercase tracking-[0.09em] text-[#f4efde]/45 [&_span]:inline-flex [&_span]:items-center [&_span]:gap-1 [&_i]:h-0.5 [&_i]:w-2 [&_i]:rounded-sm" aria-hidden="true">
        <span><i className="bg-[#8bc49b]" />Course</span>
        <span><i className="bg-sky-300" />Wind</span>
      </div>
    </section>
  )
})
