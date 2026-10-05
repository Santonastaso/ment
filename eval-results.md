# Discovery live eval (discovery-assistant)

commit `c13c498` · function v113 deployed 2026-10-05T19:05:51.856Z

## funnel: support -> industry -> finance -> career advice
- **you:** I am looking for support
  - **ment asks:** What would you like help with — for example finance, consulting or marketing? Pick one below, or tell me in your own words.
    - choices: Finance · Consulting · Marketing · Strategy · Data & Analytics · Operations
- **you:** industry
  - **ment asks:** Which field are you thinking of — for example finance, consulting or marketing? Pick one below, or tell me in your own words.
    - choices: Finance · Consulting · Marketing · Strategy · Data & Analytics · Operations
- **you:** finance
  - **ment asks:** What in finance would help most — a specific skill, a type of role, or career advice? Pick one below, or tell me in your own words.
    - choices: A specific skill · A type of role · Career advice
- **you:** career advice
  - **ment:** I couldn't find an exact match, but these people are close and could still help. Choose whoever looks most helpful and I'll draft a message. Want more options, or should I narrow it down? _[closest]_ · model ministral-3b-latest
    - Head of Finance · Finance · Cergy — 
    - Head of Finance · Finance · Cergy — 
    - Head of Finance · Finance · Cergy — 
- **PASS** [true,true,true,true,true]

## CTO 1: who are you
- **you:** Hi who are you?
  - **ment asks:** Hi! I'm Ment — I help you find people in the ESSEC network who can help with your studies or career, and I'll draft the intro message for you. What are you looking for? For example a field like finance, consulting or marketing, a skill, or a type of role.
    - choices: Finance · Consulting · Marketing · Strategy · Data & Analytics · Operations
- **PASS** [true,true]

## CTO 2: slang around a department
- **you:** nevermind, im looking for someone in finance bro
  - **ment asks:** What in finance would help most — a specific skill, a type of role, or career advice? Pick one below, or tell me in your own words.
    - choices: A specific skill · A type of role · Career advice
- **PASS** [true]

## CTO 3: react to results
- **you:** I need help with LBO modelling
  - **ment:** These people look like a great fit. Take your time, and when you've found the right person I'll draft the message for you. Happy to show more people or narrow it down — just say. · model ministral-3b-latest
    - Finance Director · Finance · London — Finance Director who teaches LBO modelling and advises on debt financing and valuation
    - Treasury Manager · Finance · Geneva — Treasury Manager with LBO modelling expertise and experience in financial due diligence
- **you:** no but i want more options not just 1 shot recommendation ask me clarifying questions come on
  - **ment asks:** Happy to narrow it down — what matters most to you: a particular city, how senior they are, or a specific skill? Pick one below, or tell me in your own words.
    - choices: More senior people · Only in London · Only in Geneva
- **PASS** [true,true]

## more options after results
- **you:** someone in finance
  - **ment asks:** What in finance would help most — a specific skill, a type of role, or career advice? Pick one below, or tell me in your own words.
    - choices: A specific skill · A type of role · Career advice
- **you:** either works
  - **ment:** Good news — I found a few people who could really help. Have a look, and when someone feels right I'll draft the message for you. Happy to show more people or narrow it down — just say. · model ministral-3b-latest
    - Head of Finance · Finance · Cergy — 
    - Head of Finance · Finance · Cergy — 
    - Head of Finance · Finance · Cergy — 
- **you:** show me more options
  - **ment:** Here are a few more people who could help. Pick whoever looks most useful and I'll draft a message. Happy to show more people or narrow it down — just say. · model ministral-3b-latest
    - Investment Associate · Finance · Cergy — Investment Associate with valuation expertise and experience in financial analysis
    - Investment Associate · Finance · Cergy — Investment Associate with valuation and financial modelling experience
- **PASS** [true,true,true,true]

## proposals, asked twice
- **you:** hi how are you?
  - **ment asks:** I'm doing great, thanks for asking—how about you today? Ready to meet someone new or pick up a new skill?
    - choices: Finance · Consulting · Marketing · Strategy · Data & Analytics · Operations
- **you:** can you propose some people to me?
  - **ment asks:** What would you like help with — for example finance, consulting or marketing? Pick one below, or tell me in your own words.
    - choices: Finance · Consulting · Marketing · Strategy · Data & Analytics · Operations
- **you:** I would like you to propose some people to me
  - **ment asks:** No problem — here are a few places people often start. What would you like help with? Pick one below, or tell me in your own words.
    - choices: Finance · Consulting · Marketing · Strategy · Data & Analytics · Operations
- **PASS** [true,true,true,true]

## choice path: interested in finance -> a specific skill
- **you:** I'm interested in finance
  - **ment asks:** What in finance would help most — a specific skill, a type of role, or career advice? Pick one below, or tell me in your own words.
    - choices: A specific skill · A type of role · Career advice
- **you:** a specific skill
  - **ment asks:** Which finance skill would you like help with?
- **PASS** [true,true]

## Italian: marketing -> una competenza precisa
- **you:** Mi interessa marketing
  - **ment asks:** Cosa ti servirebbe di piu in marketing — una competenza precisa, un tipo di ruolo o un consiglio di carriera? Scegli qui sotto, oppure scrivimelo con parole tue.
    - choices: Una competenza precisa · Un tipo di ruolo · Consigli di carriera
- **you:** una competenza precisa
  - **ment asks:** Con quale competenza in marketing ti serve aiuto?
- **PASS** [true,true,true]

## French: finance -> une compétence précise
- **you:** Je m'intéresse à finance
  - **ment asks:** Qu'est-ce qui vous aiderait le plus en finance — une competence precise, un type de poste ou un conseil de carriere ? Choisissez ci-dessous, ou dites-le-moi avec vos mots.
    - choices: Une compétence précise · Un type de poste · Des conseils de carrière
- **you:** une compétence précise
  - **ment asks:** Sur quelle competence en finance aimeriez-vous de l'aide ?
- **PASS** [true,true,true]

## follow-up about the people shown
- **you:** I am looking for someone working as consultant
  - **ment:** Good news — I found a few people who could really help. Have a look, and when someone feels right I'll draft the message for you. Want more options, or should I narrow it down? · model ministral-3b-latest
    - Management Consultant · Consulting · Singapore — Designs operating models and merges deals to integrate acquired companies
    - Senior Consultant · Consulting · London — Facilitates client workshops and evaluates commercial due diligence for high-stakes projects
    - Consultant · Consulting · Rabat — Delivers client projects with a focus on structured problem-solving and presentation skills
- **you:** is there someone with more than 5 years of experience?
  - **ment:** These people look like a great fit. Take your time, and when you've found the right person I'll draft the message for you. Happy to show more people or narrow it down — just say. · model ministral-3b-latest
    - Consultant · Consulting · Rabat — Engagement Manager who designs client workshops and delivers consulting projects
    - Consultant · Consulting · Rabat — Business Analyst who structures complex consulting engagements and presents findings clearly
    - Consultant · Consulting · Rabat — Structured problem solver who facilitates client workshops and builds consulting frameworks
- **PASS** [true,true,true]

## small talk
- **you:** how are you doing?
  - **ment asks:** I'm doing great, thanks for asking! How about you? Shall we get cracking — meeting someone new or learning a new skill?
    - choices: Finance · Consulting · Marketing · Strategy · Data & Analytics · Operations
- **PASS** [true,true,true,true,true]

## IB, then experience, then Europe
- **you:** looking for something in investment banking
  - **ment:** Good news — I found a few people who could really help. Have a look, and when someone feels right I'll draft the message for you. Want more options, or should I narrow it down? · model ministral-3b-latest
    - Venture Capital Associate · Finance · Milan — Venture Capital Associate who screens deals and advises on investment quality
    - Venture Capital Associate · Finance · Munich — Venture Capital Associate who evaluates investment opportunities and screens portfolios
- **you:** I would like someone with 3+ years of experience
  - **ment:** Nobody here matches that extra requirement — the people I showed you before are still the closest fit in the network. Want me to try a different angle? _[closest]_ · model ministral-3b-latest
    - Venture Capital Associate · Finance · Milan — Venture Capital Associate who screens deals and advises on investment quality
    - Venture Capital Associate · Finance · Munich — Venture Capital Associate who evaluates investment opportunities and screens portfolios
- **you:** what about someone working in IB in Europe?
  - **ment:** Good news — I found a few people who could really help. Have a look, and when someone feels right I'll draft the message for you. Want more options, or should I narrow it down? One of these is new; the others you have already seen. · model ministral-3b-latest
    - Venture Capital Associate · Finance · Milan — Venture Capital Associate who evaluates investment opportunities and portfolio construction
    - Portfolio Manager · Finance · Amsterdam — Portfolio Manager who sources deals and screens investments for fund strategies
- **PASS** [true,true,true,true]

## thanks
- **you:** thanks!
  - **ment asks:** Happy to help — just say if you want to look for someone else.
- **PASS** [true,true]

## department alone: marketing
- **you:** someone in marketing
  - **ment asks:** What in marketing would help most — a specific skill, a type of role, or career advice? Pick one below, or tell me in your own words.
    - choices: A specific skill · A type of role · Career advice
- **PASS** [true]

## vague: I need help
- **you:** I need help
  - **ment asks:** What would you like help with — for example finance, consulting or marketing? Pick one below, or tell me in your own words.
    - choices: Finance · Consulting · Marketing · Strategy · Data & Analytics · Operations
- **PASS** [true]

## department then either works
- **you:** someone in finance
  - **ment asks:** What in finance would help most — a specific skill, a type of role, or career advice? Pick one below, or tell me in your own words.
    - choices: A specific skill · A type of role · Career advice
- **you:** either works
  - **ment:** Good news — I found a few people who could really help. Have a look, and when someone feels right I'll draft the message for you. Want more options, or should I narrow it down? · model ministral-3b-latest
    - Head of Finance · Finance · Singapore — Leads finance strategy and reporting for a major group
    - Finance Director · Finance · London — Manages board reporting and valuation for corporate deals
    - CFO · Finance · Amsterdam — Directs financial due diligence and M&A for global operations
- **PASS** [true,true]

## absent subject: audit
- **you:** someone in audit
  - **ment:** I couldn't find anyone working in audit here, but people in financial analysis and financial reporting are close and could still help. Choose whoever looks most helpful and I'll draft a message. Happy to show more people or narrow it down — just say. _[closest]_ · model ministral-3b-latest
    - Senior Financial Analyst · Finance · New York — 
    - Head of Finance · Finance · Singapore — 
    - Treasury Manager · Finance · Brussels — 
- **PASS** [true,true,true,true]

## out of scope: painter
- **you:** I want to meet a painter
  - **ment:** I couldn't find anyone working as a painter here — most people here are in finance, marketing and operations. Tell me a bit more, like an industry, a role or a skill, and I'll have another look. · model ministral-3b-latest
- **PASS** [true,true]

## specific skill: LBO modelling
- **you:** I need help with LBO modelling
  - **ment:** Good news — I found a few people who could really help. Have a look, and when someone feels right I'll draft the message for you. Happy to show more people or narrow it down — just say. · model ministral-3b-latest
    - Treasury Manager · Finance · Geneva — LBO modelling specialist who designs valuation models and advises on capital structure
    - M&A Associate · Finance · Lisbon — LBO modelling expert who builds and refines LBO frameworks for acquisition scenarios
- **PASS** [true,true,true]

## location: senior in London
- **you:** someone senior based in London
  - **ment:** Here's someone who looks like a strong match. If they feel right, I'll draft the message for you. Want more options, or should I narrow it down? · model ministral-3b-latest
    - Senior Product Manager · Product · London — Leads product strategy and roadmap for a London-based tech firm
- **PASS** [true]

## department + location: finance in Milan
- **you:** someone in finance in Milan
  - **ment:** I found someone who could be a great fit. Take a look — if they feel right, I'll draft the message for you. Want more options, or should I narrow it down? · model ministral-3b-latest
    - Venture Capital Associate · Finance · Milan — Finance Associate with experience in equity research and portfolio construction
- **PASS** [true,true,true]

## near subject: accounting
- **you:** somebody who works in accounting
  - **ment:** I couldn't find anyone working in accounting here, but this person has a background in budgeting and could still help. If they look useful, I'll draft a message. Happy to show more people or narrow it down — just say. _[closest]_ · model ministral-3b-latest
    - Head of Finance · Finance · Singapore — Head of Finance who mentors teams and supports professional growth
- **PASS** [true,true,true]

## synonym: bookkeeping
- **you:** someone who does bookkeeping
  - **ment:** I couldn't find anyone working in bookkeeping here, but people in budgeting are close and could still help. Choose whoever looks most helpful and I'll draft a message. Want more options, or should I narrow it down? _[closest]_ · model ministral-3b-latest
    - Senior Financial Analyst · Finance · New York — Owned monthly close and financial reporting for a tech firm
    - Head of Finance · Finance · Singapore — Led FP&A and budgeting for a 200-person finance organization
    - Finance Director · Finance · London — Performed financial due diligence for M&A transactions
- **PASS** [true,true,true]

**23/23 scenarios passed**

_test account password cleared_
