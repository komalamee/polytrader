'use client';

import { useMemo, useState } from 'react';
import styles from './polytrader.module.css';

const riskLocks = {
  maxTradeUsd: 10,
  maxDailyLossUsd: 30,
  killSwitch: 'hard kill at -$30 daily realised pnl'
};

const opportunities = [
  { market: 'Fed holds rates in Q2', edge: '+4.2%', confidence: 0.71 },
  { market: 'ETH ETF inflow > $300m this week', edge: '+2.9%', confidence: 0.64 },
  { market: 'US CPI prints under consensus', edge: '+3.5%', confidence: 0.67 }
];

const execTape = [
  'paper buy 7.2 @ 0.41 | fed-hold-q2',
  'paper sell 4.0 @ 0.57 | cpi-under-consensus',
  'risk check pass | exposure 19.4/30.0'
];

export default function PolytraderDashboardClient() {
  const [mode, setMode] = useState('paper');
  const [lastSwitchAt, setLastSwitchAt] = useState(null);

  const statusLabel = useMemo(() => {
    return mode === 'live' ? 'live execution armed' : 'paper mode active';
  }, [mode]);

  function switchMode(nextMode) {
    if (nextMode === mode) return;

    if (nextMode === 'live') {
      const ok = window.confirm(
        'arm live trading? real orders will be sent. risk locks stay enforced.'
      );
      if (!ok) return;
    }

    setMode(nextMode);
    setLastSwitchAt(new Date().toISOString());
  }

  return (
    <main className={styles.wrap}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>revenue / polytrader</p>
          <h1>polytrader execution</h1>
          <p className={styles.subtitle}>{statusLabel}</p>
        </div>

        <div className={styles.modeSwitch} role="group" aria-label="execution mode toggle">
          <button
            type="button"
            onClick={() => switchMode('paper')}
            className={mode === 'paper' ? styles.active : ''}
          >
            paper
          </button>
          <button
            type="button"
            onClick={() => switchMode('live')}
            className={mode === 'live' ? styles.activeLive : ''}
          >
            live
          </button>
        </div>
      </header>

      <section className={styles.stats}>
        <article>
          <span>daily pnl</span>
          <strong>{mode === 'live' ? '+$4.10' : '+$2.42'}</strong>
        </article>
        <article>
          <span>win rate</span>
          <strong>63.7%</strong>
        </article>
        <article>
          <span>exposure</span>
          <strong>$19.4 / $30.0</strong>
        </article>
        <article>
          <span>mode</span>
          <strong>{mode.toUpperCase()}</strong>
        </article>
      </section>

      <section className={styles.grid}>
        <article className={styles.card}>
          <h2>risk locks</h2>
          <ul>
            <li>max trade: ${riskLocks.maxTradeUsd.toFixed(2)}</li>
            <li>max daily loss: ${riskLocks.maxDailyLossUsd.toFixed(2)}</li>
            <li>{riskLocks.killSwitch}</li>
          </ul>
          {lastSwitchAt ? <p className={styles.meta}>last switch: {lastSwitchAt}</p> : null}
        </article>

        <article className={styles.card}>
          <h2>live opportunities</h2>
          <ul>
            {opportunities.map((row) => (
              <li key={row.market}>
                <div>
                  <strong>{row.market}</strong>
                  <small>confidence {Math.round(row.confidence * 100)}%</small>
                </div>
                <span>{row.edge}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className={styles.card}>
          <h2>execution tape</h2>
          <ul>
            {execTape.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </article>
      </section>
    </main>
  );
}
