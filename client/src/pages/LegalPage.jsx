import { Link } from 'react-router-dom';

const POLICIES = {
  terms: {
    title: 'Terms of use',
    intro: 'These terms govern access to Ment, a platform for arranging knowledge-sharing conversations between members of participating organizations.',
    sections: [
      ['Your account', 'Use accurate profile information, protect your login credentials, and notify your organization if you believe your account has been compromised.'],
      ['Acceptable use', 'Use Ment to make relevant professional or educational connections. Do not scrape profiles, impersonate another person, harass members, or upload material you do not have permission to share.'],
      ['Sessions and messages', 'Members decide whether to accept a request. Ment does not guarantee a match, response, meeting, employment outcome, or professional advice.'],
      ['Organization access', 'Your organization controls membership and may manage account access. Private reflections and ratings are not exposed to other members through the product.'],
      ['Service changes', 'Features may change as the product develops. Material changes to these terms will be communicated through the service or the account contact.'],
    ],
  },
  privacy: {
    title: 'Privacy notice',
    intro: 'This notice explains the information Ment uses to provide matching, scheduling, and program reporting.',
    sections: [
      ['Information collected', 'Ment stores account details, organization membership, profile information, skills, availability, connection requests, meeting status, and feedback you choose to provide.'],
      ['How information is used', 'Profile and request data is used to rank relevant people, operate sessions, send service notifications, protect the platform, and provide aggregate program reporting.'],
      ['Private information', 'Individual reflections and ratings remain private in the member experience. Organization reporting uses aggregate outcomes unless a feature clearly states otherwise.'],
      ['Service providers', 'Authentication, database, and hosting services are provided through the deployment infrastructure configured by Ment, including Supabase. Providers process data only to operate the service.'],
      ['Your choices', 'You can update profile information in Ment and contact your organization to request access, correction, export, or deletion where applicable.'],
      ['Contact', 'Questions about this notice can be sent to privacy@ment.io.'],
    ],
  },
};

export default function LegalPage({ type }) {
  const policy = POLICIES[type] || POLICIES.terms;
  return <div className="min-h-screen bg-background"><header className="border-b border-[var(--border)]"><div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4"><Link to="/welcome" className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-full bg-primary text-xs font-bold text-white">M</span><strong>MENT</strong></Link><Link to="/welcome" className="text-sm text-muted-foreground hover:text-foreground">Back to Ment</Link></div></header><main className="mx-auto max-w-3xl px-6 py-14"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Effective 8 September 2026</p><h1 className="marketing-display mt-3 text-5xl">{policy.title}</h1><p className="mt-6 max-w-2xl text-lg leading-7 text-muted-foreground">{policy.intro}</p><div className="mt-12 border-t border-[var(--border)]">{policy.sections.map(([title, body]) => <section key={title} className="grid gap-3 border-b border-[var(--border)] py-6 sm:grid-cols-[180px_1fr]"><h2 className="text-sm font-semibold">{title}</h2><p className="text-sm leading-6 text-muted-foreground">{body}</p></section>)}</div></main></div>;
}
