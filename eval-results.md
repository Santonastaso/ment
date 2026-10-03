# Discovery live eval

commit `8090790` · function v103 deployed 2026-10-03T16:41:58.199Z

## funnel: support -> industry -> finance -> career advice
- **you:** I am looking for support
  - **ment asks:** What would you like help with — for example finance, consulting or marketing?
- **you:** industry
  - **ment asks:** Which field are you thinking of — for example finance, consulting or marketing?
- **you:** finance
  - **ment asks:** What in finance would help most — a specific skill, a type of role, or career advice?
- **you:** career advice
  - **ment:** (exact matches) · model ministral-3b-latest
    - CFO · Finance · Amsterdam — Treasury Manager with deep experience in LBOs, M&A, and financial structuring for high-growth deals
    - CFO · Finance · Singapore — CFO with hands-on experience in M&A and board reporting to advise on industry shifts
- **PASS** [true,true,true,true]

## department alone: marketing
- **you:** someone in marketing
  - **ment asks:** What in marketing would help most — a specific skill, a type of role, or career advice?
- **PASS** [true]

## vague: I need help
- **you:** I need help
  - **ment asks:** What would you like help with — for example finance, consulting or marketing?
- **PASS** [true]

## department then either works
- **you:** someone in finance
  - **ment asks:** What in finance would help most — a specific skill, a type of role, or career advice?
- **you:** either works
  - **ment:** (exact matches) · model ministral-3b-latest
    - Head of Finance · Finance · Singapore — Teaches three-statement modelling and board reporting
    - CFO · Finance · Amsterdam — Manages financial due diligence and LBO modelling
    - CFO · Finance · Singapore — Handles board reporting and capital structure planning
- **PASS** [true,true]

## absent subject: audit
- **you:** someone in audit
  - **ment:** I couldn't find anyone working in audit here, but people in financial analysis and compliance are close and could still help. Choose whoever looks most helpful and I'll draft a message. _[closest]_ · model ministral-3b-latest
    - Venture Capital Associate · Finance · Milan — Manages investment screening and portfolio risk at a VC firm
    - Regulatory Affairs Lead · Public Policy · Brussels — Leads EU regulatory strategy for a public policy team
- **PASS** [true,true,true,true]

## out of scope: painter
- **you:** I want to meet a painter
  - **ment:** I couldn't find anyone working as a painter here — most people in the network work in finance, marketing and operations. Could you tell me a bit more, like the industry, a job title or a skill you're after? I'll take another look. · model ministral-3b-latest
- **PASS** [true,true]

## specific skill: LBO modelling
- **you:** I need help with LBO modelling
  - **ment:** (exact matches) · model ministral-3b-latest
    - Finance Director · Finance · London — Finance Director who specializes in LBO modelling and debt financing for high-growth companies
    - Treasury Manager · Finance · Geneva — Treasury Manager with deep LBO modelling experience and company valuation skills
    - CFO · Finance · Amsterdam — CFO with hands-on LBO modelling expertise and M&A process management
- **PASS** [true,true,true]

## location: senior in London
- **you:** someone senior based in London
  - **ment:** (exact matches) · model ministral-3b-latest
    - Senior Product Manager · Product · London — Leads product strategy and roadmap for a London-based company
- **PASS** [true]

## department + location: finance in Milan
- **you:** someone in finance in Milan
  - **ment:** (exact matches) · model ministral-3b-latest
    - Venture Capital Associate · Finance · Milan — Finance Associate with experience in equity research and portfolio construction in Milan
- **PASS** [true,true,true]

## near subject: accounting
- **you:** somebody who works in accounting
  - **ment:** I couldn't find anyone working in accounting here, but this person has a background in finance and operations and could still help. If they look useful, I'll draft a message. _[closest]_ · model ministral-3b-latest
    - Senior Financial Analyst · Finance · New York — Leads financial analysis and supports leadership development in finance teams
- **PASS** [true,true,true]

## synonym: bookkeeping
- **you:** someone who does bookkeeping
  - **ment:** I couldn't find anyone working in bookkeeping here, but people in budgeting and financial reporting are close and could still help. Pick whoever looks most useful and I'll draft a message. _[closest]_ · model ministral-3b-latest
    - Senior Financial Analyst · Finance · New York — Owns monthly close and financial reporting for a finance team
    - Head of Finance · Finance · Singapore — Led FP&A and budgeting for a 200-person finance organization
- **PASS** [true,true,true]

**11/11 scenarios passed**

_test account password cleared_
