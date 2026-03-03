import IdeasDashboardClient from './IdeasDashboardClient';

export const metadata = {
  title: 'Ideas Dashboard | Komal Amin',
  description: 'Review scored opportunities and push the best ideas to Battlestation.'
};

export const dynamic = 'force-dynamic';

export default function IdeasPage() {
  return <IdeasDashboardClient />;
}
