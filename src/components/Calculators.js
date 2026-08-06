import React, { useState } from 'react';
import PipCalculator from './PipCalculator';
import PLCalculator from './PLCalculator';
import TradingWizardContainer from './TradingWizard';

export default function Calculators({ trades, onOpen, onOpenForm, accountCurrency, accountSize, usdRate }) {
  const [active, setActive] = useState(null); // null | 'pip' | 'pl' | 'wizard'

  const handleOpenTrade = (data) => {
    onOpen(data);
    setActive(null);
  };

  const handleOpenTradeForm = (data) => {
    onOpenForm(data);
    setActive(null);
  };

  return (
    <div className="calcs-wrap">

      {/* ── Hub ── */}
      {active === null && (
        <div className="calcs-hub">
          {/* <div className="calcs-hub-title">CALCULATORS</div> */}
          <div className="calcs-hub-grid">

            <button className="calcs-card" onClick={() => setActive('pip')}>
              <div className="calcs-card-icon">⊞</div>
              <div className="calcs-card-name">PIP CALCULATOR</div>
              <div className="calcs-card-desc">
                Calculate pip value and estimated P/L for any pip count and lot size. Includes scenario table.
              </div>
              <div className="calcs-card-cta">OPEN CALCULATOR →</div>
            </button>

            <button className="calcs-card" onClick={() => setActive('pl')}>
              <div className="calcs-card-icon">◎</div>
              <div className="calcs-card-name">P/L ESTIMATOR</div>
              <div className="calcs-card-desc">
                Estimate profit &amp; loss at your SL and TP targets. Load inputs from an open trade or open a new position directly.
              </div>
              <div className="calcs-card-cta">OPEN CALCULATOR →</div>
            </button>

            <button className="calcs-card" onClick={() => setActive('wizard')}>
              <div className="calcs-card-icon">🧭</div>
              <div className="calcs-card-name">TRADING WIZARD</div>
              <div className="calcs-card-desc">
                Multi-step guided decision helper. Score confluence, validate RRR, and size your position from a 6-step interactive wizard.
              </div>
              <div className="calcs-card-cta">OPEN WIZARD →</div>
            </button>

          </div>
        </div>
      )}

      {/* ── Pip Calculator — inline ── */}
      {active === 'pip' && (
        <div className="calcs-pl-wrap">
          <button className="calcs-back-btn" onClick={() => setActive(null)}>← BACK TO CALCULATORS</button>
          <PipCalculator />
        </div>
      )}

      {/* ── P/L Estimator — inline ── */}
      {active === 'pl' && (
        <div className="calcs-pl-wrap">
          <button className="calcs-back-btn" onClick={() => setActive(null)}>← BACK TO CALCULATORS</button>
          <PLCalculator
            trades={trades}
            onOpenForm={handleOpenTradeForm}
            accountCurrency={accountCurrency}
            accountSize={accountSize}
            usdRate={usdRate}
          />
        </div>
      )}

      {/* ── Trading Wizard — inline ── */}
      {active === 'wizard' && (
        <div className="calcs-pl-wrap">
          <button className="calcs-back-btn" onClick={() => setActive(null)}>← BACK TO CALCULATORS</button>
          <TradingWizardContainer />
        </div>
      )}

    </div>
  );
}
