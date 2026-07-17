/**
 * CPA Topic Taxonomy
 * Full section → topic → subtopic hierarchy for the CPA Exam (CPA Evolution model).
 * Used for question categorization, adaptive difficulty, and UI rendering.
 *
 * Core sections (required for all candidates): AUD, FAR, REG
 * Discipline sections (candidate selects one): BAR, ISC, TCP
 *
 * Structure follows the AICPA CPA Exam Blueprints at a high level — validate
 * against the current published blueprint before final content generation,
 * since the AICPA revises blueprints periodically.
 */

export type Subtopic = { id: string; label: string };
export type Topic = { id: string; label: string; subtopics: Subtopic[] };
export type Subject = {
  id: string;
  label: string;
  fullName: string;
  kind: "core" | "discipline";
  topics: Topic[];
};

export const CPA_TOPICS: Subject[] = [
  {
    id: "aud",
    label: "AUD",
    fullName: "Auditing and Attestation",
    kind: "core",
    topics: [
      {
        id: "ethics_professional_responsibilities",
        label: "Ethics, Professional Responsibilities & General Principles",
        subtopics: [
          { id: "aicpa_code_of_conduct", label: "AICPA Code of Professional Conduct" },
          { id: "independence_rules", label: "Independence Rules" },
          { id: "engagement_acceptance", label: "Engagement Acceptance & Quality Management" },
          { id: "professional_skepticism", label: "Professional Skepticism & Judgment" },
          { id: "legal_liability", label: "Legal Liability of Auditors" },
        ],
      },
      {
        id: "assessing_risk",
        label: "Assessing Risk & Developing a Planned Response",
        subtopics: [
          { id: "audit_planning", label: "Audit Planning & Materiality" },
          { id: "understanding_entity", label: "Understanding the Entity & Its Environment" },
          { id: "internal_control", label: "Internal Control Evaluation" },
          { id: "risk_assessment_procedures", label: "Risk Assessment Procedures" },
          { id: "fraud_risk", label: "Fraud Risk & Illegal Acts" },
        ],
      },
      {
        id: "performing_procedures",
        label: "Performing Further Procedures & Obtaining Evidence",
        subtopics: [
          { id: "audit_sampling", label: "Audit Sampling" },
          { id: "substantive_procedures", label: "Substantive Procedures" },
          { id: "analytical_procedures", label: "Analytical Procedures" },
          { id: "specialists_service_orgs", label: "Using Specialists & Service Organizations" },
          { id: "it_general_controls", label: "IT General Controls & Data Analytics" },
        ],
      },
      {
        id: "forming_conclusions",
        label: "Forming Conclusions & Reporting",
        subtopics: [
          { id: "audit_reports", label: "Audit Report Types & Modifications" },
          { id: "subsequent_events", label: "Subsequent Events & Going Concern" },
          { id: "review_compilation", label: "Reviews & Compilation Engagements (SSARS)" },
          { id: "group_audits", label: "Group Audits & Component Auditors" },
          { id: "written_representations", label: "Written Representations & Communications" },
        ],
      },
    ],
  },
  {
    id: "far",
    label: "FAR",
    fullName: "Financial Accounting and Reporting",
    kind: "core",
    topics: [
      {
        id: "financial_reporting",
        label: "Financial Reporting",
        subtopics: [
          { id: "conceptual_framework", label: "Conceptual Framework & Standard Setting" },
          { id: "financial_statement_prep", label: "General-Purpose Financial Statement Preparation" },
          { id: "disclosures", label: "Disclosure Requirements" },
          { id: "special_purpose_frameworks", label: "Special Purpose Frameworks" },
          { id: "not_for_profit_far", label: "Not-for-Profit Accounting" },
        ],
      },
      {
        id: "balance_sheet_accounts",
        label: "Select Balance Sheet Accounts",
        subtopics: [
          { id: "cash_receivables", label: "Cash & Receivables" },
          { id: "inventory", label: "Inventory Costing & Valuation" },
          { id: "ppe", label: "Property, Plant & Equipment" },
          { id: "intangible_assets", label: "Intangible Assets & Goodwill" },
          { id: "liabilities", label: "Current & Long-Term Liabilities" },
          { id: "equity", label: "Stockholders' Equity" },
        ],
      },
      {
        id: "select_transactions",
        label: "Select Transactions",
        subtopics: [
          { id: "revenue_recognition", label: "Revenue Recognition (ASC 606)" },
          { id: "leases", label: "Leases (ASC 842)" },
          { id: "income_taxes_far", label: "Accounting for Income Taxes" },
          { id: "business_combinations", label: "Business Combinations & Consolidations" },
          { id: "eps_far", label: "Earnings Per Share" },
          { id: "statement_of_cash_flows", label: "Statement of Cash Flows" },
        ],
      },
      {
        id: "state_local_govt",
        label: "State & Local Governments",
        subtopics: [
          { id: "fund_accounting", label: "Fund Accounting Structure" },
          { id: "govt_wide_statements", label: "Government-Wide Financial Statements" },
          { id: "budgetary_accounting", label: "Budgetary Accounting" },
          { id: "modified_accrual", label: "Modified Accrual Basis" },
        ],
      },
    ],
  },
  {
    id: "reg",
    label: "REG",
    fullName: "Regulation",
    kind: "core",
    topics: [
      {
        id: "ethics_tax_procedures",
        label: "Ethics, Professional Responsibilities & Federal Tax Procedures",
        subtopics: [
          { id: "circular_230", label: "Treasury Circular 230" },
          { id: "tax_preparer_penalties", label: "Tax Return Preparer Penalties" },
          { id: "irs_procedures", label: "IRS Audit & Appeals Procedures" },
          { id: "federal_tax_legislative", label: "Federal Tax Legislative Process" },
        ],
      },
      {
        id: "business_law",
        label: "Business Law",
        subtopics: [
          { id: "contracts", label: "Contract Formation & Performance" },
          { id: "agency", label: "Agency Relationships" },
          { id: "business_structures", label: "Business Structures & Governance" },
          { id: "ucc_sales", label: "UCC — Sales & Secured Transactions" },
          { id: "bankruptcy", label: "Bankruptcy & Debtor-Creditor Relationships" },
          { id: "federal_securities_law", label: "Federal Securities Regulation" },
        ],
      },
      {
        id: "property_transactions",
        label: "Federal Taxation of Property Transactions",
        subtopics: [
          { id: "basis_property", label: "Basis of Property" },
          { id: "gain_loss_recognition", label: "Gain/Loss Recognition & Character" },
          { id: "like_kind_exchanges", label: "Like-Kind Exchanges & Involuntary Conversions" },
          { id: "depreciation_cost_recovery", label: "Depreciation, Amortization & Cost Recovery" },
        ],
      },
      {
        id: "individual_taxation",
        label: "Federal Taxation of Individuals",
        subtopics: [
          { id: "gross_income", label: "Gross Income Inclusions & Exclusions" },
          { id: "adjustments_deductions", label: "Adjustments & Itemized Deductions" },
          { id: "individual_credits", label: "Tax Credits for Individuals" },
          { id: "filing_status_amt", label: "Filing Status & Alternative Minimum Tax" },
        ],
      },
      {
        id: "entity_taxation",
        label: "Federal Taxation of Entities",
        subtopics: [
          { id: "c_corp_taxation", label: "C Corporation Taxation" },
          { id: "s_corp_taxation", label: "S Corporation Taxation" },
          { id: "partnership_taxation", label: "Partnership Taxation" },
          { id: "exempt_organizations", label: "Tax-Exempt Organizations" },
        ],
      },
    ],
  },
  {
    id: "bar",
    label: "BAR",
    fullName: "Business Analysis and Reporting",
    kind: "discipline",
    topics: [
      {
        id: "business_analysis",
        label: "Business Analysis",
        subtopics: [
          { id: "financial_statement_analysis", label: "Financial Statement Analysis" },
          { id: "variance_analysis", label: "Budgeting & Variance Analysis" },
          { id: "financial_valuation", label: "Financial Valuation Methods" },
          { id: "risk_management_bar", label: "Enterprise Risk Management" },
          { id: "cost_accounting", label: "Managerial & Cost Accounting" },
        ],
      },
      {
        id: "technical_accounting_reporting",
        label: "Technical Accounting & Reporting",
        subtopics: [
          { id: "stock_compensation", label: "Stock Compensation" },
          { id: "derivatives_hedging", label: "Derivatives & Hedge Accounting" },
          { id: "business_combinations_bar", label: "Advanced Business Combinations" },
          { id: "revenue_recognition_bar", label: "Complex Revenue Recognition" },
          { id: "eps_complex", label: "Complex EPS Calculations" },
        ],
      },
      {
        id: "state_local_govt_bar",
        label: "State & Local Governments (Advanced)",
        subtopics: [
          { id: "govt_fund_reporting", label: "Government Fund Financial Reporting" },
          { id: "govt_wide_reconciliation", label: "Government-Wide Reconciliations" },
          { id: "component_units", label: "Component Units & Reporting Entity" },
        ],
      },
    ],
  },
  {
    id: "isc",
    label: "ISC",
    fullName: "Information Systems and Controls",
    kind: "discipline",
    topics: [
      {
        id: "information_systems_data",
        label: "Information Systems & Data Management",
        subtopics: [
          { id: "it_governance", label: "IT Governance Frameworks" },
          { id: "data_management", label: "Data Management & Data Governance" },
          { id: "system_development_lifecycle", label: "System Development Lifecycle" },
          { id: "business_process_controls", label: "Business Process Controls" },
        ],
      },
      {
        id: "security_confidentiality_privacy",
        label: "Security, Confidentiality & Privacy",
        subtopics: [
          { id: "access_controls", label: "Access Controls & Authentication" },
          { id: "cybersecurity_frameworks", label: "Cybersecurity Frameworks (NIST, COBIT)" },
          { id: "data_privacy_regs", label: "Data Privacy Regulations" },
          { id: "incident_response", label: "Incident Response & Business Continuity" },
        ],
      },
      {
        id: "soc_engagements",
        label: "Considerations for SOC Engagements",
        subtopics: [
          { id: "soc_report_types", label: "SOC 1 / SOC 2 Report Types" },
          { id: "trust_services_criteria", label: "Trust Services Criteria" },
          { id: "control_testing_it", label: "IT Control Testing Approaches" },
        ],
      },
    ],
  },
  {
    id: "tcp",
    label: "TCP",
    fullName: "Tax Compliance and Planning",
    kind: "discipline",
    topics: [
      {
        id: "individual_tax_planning",
        label: "Tax Compliance & Planning for Individuals",
        subtopics: [
          { id: "individual_tax_planning_strategies", label: "Individual Tax Planning Strategies" },
          { id: "retirement_planning_tax", label: "Retirement Plan Taxation" },
          { id: "estate_gift_planning", label: "Estate & Gift Tax Planning" },
          { id: "personal_financial_planning", label: "Personal Financial Planning" },
        ],
      },
      {
        id: "entity_tax_compliance",
        label: "Entity Tax Compliance",
        subtopics: [
          { id: "entity_return_prep", label: "Entity Tax Return Preparation" },
          { id: "entity_credits_deductions", label: "Entity Credits & Deductions" },
          { id: "multistate_taxation", label: "Multistate Taxation Considerations" },
        ],
      },
      {
        id: "entity_tax_planning",
        label: "Entity Tax Planning",
        subtopics: [
          { id: "entity_choice_planning", label: "Entity Choice & Structuring" },
          { id: "reorganizations", label: "Corporate Reorganizations" },
          { id: "int_tax_considerations", label: "International Tax Considerations" },
        ],
      },
      {
        id: "property_transactions_tcp",
        label: "Property Transactions",
        subtopics: [
          { id: "disposition_planning", label: "Tax Planning for Asset Dispositions" },
          { id: "like_kind_planning", label: "Like-Kind Exchange Planning" },
          { id: "installment_sales", label: "Installment Sales & Deferred Recognition" },
        ],
      },
    ],
  },
];

/** Core sections every candidate must pass. */
export const CPA_CORE_SECTIONS = CPA_TOPICS.filter((s) => s.kind === "core").map((s) => s.id);

/** Discipline sections — candidate selects exactly one. */
export const CPA_DISCIPLINE_SECTIONS = CPA_TOPICS.filter((s) => s.kind === "discipline").map((s) => s.id);

/** Helper — get all subtopic IDs as a flat array */
export function getAllSubtopicIds(): string[] {
  return CPA_TOPICS.flatMap((s) =>
    s.topics.flatMap((t) => t.subtopics.map((st) => st.id))
  );
}

/** Helper — look up a subject (section) by ID */
export function getSubjectById(id: string): Subject | undefined {
  return CPA_TOPICS.find((s) => s.id === id);
}

/** Helper — look up a topic by ID across all sections */
export function getTopicById(id: string): Topic | undefined {
  for (const subject of CPA_TOPICS) {
    const topic = subject.topics.find((t) => t.id === id);
    if (topic) return topic;
  }
  return undefined;
}
