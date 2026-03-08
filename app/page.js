import Link from 'next/link';

export default function Home() {
  return (
    <main className="wrap">
      <nav>
        <strong>komalamin.com</strong>
        <div className="links">
          <Link href="/work">Work</Link>
          <Link href="/about">About</Link>
          <Link href="/writing">Writing</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/polytrader">Revenue</Link>
        </div>
      </nav>

      <section className="hero">
        <div className="card">
          <h1>Builder at the intersection of AI, product, and growth</h1>
          <p>Not a consultant. Not pitching ideas. I ship products, lead teams, and figure out how things actually work.</p>
          <div>
            <span className="tag">[AI-Native]</span><span className="tag">[Growth]</span><span className="tag">[Crypto]</span><span className="tag">[Creative Tech]</span>
          </div>
        </div>
        <aside className="card">
          <h3>Live build log</h3>
          <p className="muted">Building komalamin.com v1, running Kendra agent hive workflows, iterating on options platform concept.</p>
        </aside>
      </section>

      <section className="grid3">
        <article className="card"><h3>Kendra Agent Hive</h3><p>Autonomous AI workforce handling dev, research, ops, and content flows.</p></article>
        <article className="card"><h3>Nomad Pro</h3><p>Founding team member, scaled from 0 to 500K users in 18 months.</p></article>
        <article className="card"><h3>Building in Public</h3><p>Shipping experiments and sharing what works.</p></article>
      </section>
    </main>
  );
}
