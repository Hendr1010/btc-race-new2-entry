// BTC race bot for round btc-race-24h-20261113-2314.
// Strategy: fast dip-buying (mean reversion).
//   - Wait 10 bars, then track the 10-bar simple mean of closes.
//   - BUY full cash when the close is at least 0.6% below the 10-bar mean
//     (DIP 0.006). The 10-bar mean adapts fast, so this fires on real dips.
//   - SELL at +2.0% take-profit (TAKE_PROFIT 1.02) or on a 1.5% pullback
//     from the peak (TRAIL_BELOW_PEAK 0.985), whichever comes first.
//   - Long only, max 1 open position, fully deterministic, no wall clock,
//     no network, max_slippage_bps 100.
//
// Tuning (grade-local --driver process, this round's dev window, -4.91%):
//   - This bot (DIP 0.006, TP 1.02, trail 0.985): net PnL +$19.84,
//     1 round trip, win rate 1.00, maxDD 1.07%. PASSES the dev gate.
//   - Same bot with TP 1.015: +$14.04. TP 1.018: +$15.58. TP 1.02 is the
//     best of the plateau (TP 1.02 wins because the hour-7 bounce runs
//     ~2% from the dip entry).
//   - The previous round's pullback bot scores $0.00 (0 trades) here —
//     it does not transfer, because this window is a steep downtrend and
//     the pullback-from-high never triggers.
//   - A bounce bot (buy a cross above the 20-bar mean, TP 1.006) looked
//     good in a Python backtest (+$8.40) but grade-local says -$4.42:
//     the real fill cost is ~20 bps/side (fee 4 + slippage 2 + pool
//     impact ~14), so a 0.6% TP leaves almost nothing after costs.
//     A 2.0% TP is wide enough to survive the fill cost. Do not tighten it.
import { runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';
const SYMBOL = 'CBBTC';
const MEAN_BARS = 10;
const DIP = 0.006;
const TAKE_PROFIT = 1.02;
const TRAIL_BELOW_PEAK = 0.985;
const MAX_SLIPPAGE_BPS = 100;
const closes: number[] = [];
let entryPrice: number | null = null;
let peakPrice = 0;
await runBars({
  onBatch(state: BarsState, batch) {
    for (const fill of batch.fills) {
      if (fill.symbol !== SYMBOL || fill.status !== 'filled') continue;
      if (fill.side === 'buy') { entryPrice = Number(fill.price); peakPrice = Number(fill.price); }
      else if (fill.side === 'sell') { entryPrice = null; }
    }
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined) return [];
    const close = Number(bar.c);
    closes.push(close);
    if (closes.length <= MEAN_BARS) return [];
    let sum = 0;
    for (let j = closes.length - MEAN_BARS; j < closes.length; j++) sum += closes[j];
    const mean = sum / MEAN_BARS;
    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      if (entryPrice === null) entryPrice = close;
      if (close > peakPrice) peakPrice = close;
      const sell: SellInput = { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
      if (close >= entryPrice * TAKE_PROFIT) return [sell];
      if (close <= peakPrice * TRAIL_BELOW_PEAK) return [sell];
      return [];
    }
    if (close < mean * (1 - DIP)) {
      const room = state.weightRoom(SYMBOL);
      let slice = state.cash < room ? state.cash : room;
      if (slice === 0n || slice < BigInt(state.hello.fees.min_notional_quote_units)) return [];
      const buy: BuyInput = { side: 'buy', symbol: SYMBOL, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS };
      return [buy];
    }
    return [];
  },
});
