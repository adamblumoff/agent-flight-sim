import { forwardRef } from 'react'

export const FlightCompass = forwardRef<HTMLDivElement>(function FlightCompass(_, ref) {
  return (
    <section className="flight-compass" ref={ref} aria-label="Flight compass. Route pending.">
      <div className="flight-compass-face" aria-hidden="true">
        <div className="flight-compass-card" data-compass-card>
          <span className="compass-north">N</span>
          <span className="compass-east">E</span>
          <span className="compass-south">S</span>
          <span className="compass-west">W</span>
        </div>
        <div className="flight-course-needle" data-course-needle><i /></div>
        <div className="flight-wind-needle" data-wind-needle><i /></div>
        <div className="flight-compass-aircraft"><i /><b /></div>
      </div>
      <div className="flight-compass-data">
        <div><span>Heading</span><strong data-heading-value>000°</strong></div>
        <div><span>Next fix</span><strong data-course-value>Route pending</strong></div>
        <div><span>Wind from</span><strong data-wind-value>000° · 0 kt</strong></div>
      </div>
      <div className="flight-compass-key" aria-hidden="true">
        <span><i data-key="course" />Course</span>
        <span><i data-key="wind" />Wind</span>
      </div>
    </section>
  )
})
