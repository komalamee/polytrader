import PolytraderDashboardClient from './PolytraderDashboardClient';

export const metadata = {
  title: 'PolyTrader | Komal Amin',
  description: 'Prediction market trading dashboard with paper/live execution modes and hard risk locks.'
};

export const dynamic = 'force-dynamic';

export default function PolytraderPage() {
  return <PolytraderDashboardClient />;
}
