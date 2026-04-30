import React from 'react';

export default function HeroIntro({ onBegin, onScrollToTheory }) {
  return (
    <section className="tlw-hero">
      <div className="tlw-hero-inner">
        <div className="tlw-hero-eyebrow">forgiveness · a walk</div>
        <h1 className="tlw-hero-title">
          A forgiveness practice, <em>in your own words.</em>
        </h1>
        <p className="tlw-hero-subhead">
          Two words from you. Three layers walked. A mantra, sent to your inbox.
        </p>
        <div className="tlw-hero-actions">
          <button type="button" className="tlw-btn tlw-btn-primary tlw-btn-large" onClick={onBegin}>
            Begin the practice <i className="ph-light ph-arrow-right"></i>
          </button>
          <button type="button" className="tlw-hero-secondary" onClick={onScrollToTheory}>
            or first, walk the three layers ↓
          </button>
        </div>
      </div>
    </section>
  );
}
