"""
Content Generation Workflow — orchestrates multi-step CPA exam content generation
using Agno Workflow and persists to Supabase.

Idempotent: skips topics/subtopics/problems that already exist in the DB.
"""

import asyncio
from agno.workflow import Workflow

from app.utils.db import (
    save_topic,
    save_subtopic,
    save_problems,
    get_topic_by_slug,
    get_subtopic,
    get_problem_count,
)
from app.pre_generation.topic_generator import generate_topic
from app.pre_generation.subtopic_generator import generate_subtopic
from app.pre_generation.problem_generator import generate_problems_batch, BATCH_SIZE

# Content maps ported from src/lib/cpaTopics.ts — one per CPA Exam section.
# Core sections (required for all candidates): AUD, FAR, REG
# Discipline sections (candidate selects one): BAR, ISC, TCP

AUD_CONTENT_MAP = {
    "Ethics, Professional Responsibilities & General Principles": {
        "order": 1,
        "icon": "⚖️",
        "color": "blue",
        "subtopics": [
            "AICPA Code of Professional Conduct",
            "Independence Rules",
            "Engagement Acceptance & Quality Management",
            "Professional Skepticism & Judgment",
            "Legal Liability of Auditors",
        ],
    },
    "Assessing Risk & Developing a Planned Response": {
        "order": 2,
        "icon": "🔍",
        "color": "purple",
        "subtopics": [
            "Audit Planning & Materiality",
            "Understanding the Entity & Its Environment",
            "Internal Control Evaluation",
            "Risk Assessment Procedures",
            "Fraud Risk & Illegal Acts",
        ],
    },
    "Performing Further Procedures & Obtaining Evidence": {
        "order": 3,
        "icon": "📋",
        "color": "green",
        "subtopics": [
            "Audit Sampling",
            "Substantive Procedures",
            "Analytical Procedures",
            "Using Specialists & Service Organizations",
            "IT General Controls & Data Analytics",
        ],
    },
    "Forming Conclusions & Reporting": {
        "order": 4,
        "icon": "📝",
        "color": "amber",
        "subtopics": [
            "Audit Report Types & Modifications",
            "Subsequent Events & Going Concern",
            "Reviews & Compilation Engagements (SSARS)",
            "Group Audits & Component Auditors",
            "Written Representations & Communications",
        ],
    },
}

FAR_CONTENT_MAP = {
    "Financial Reporting": {
        "order": 1,
        "icon": "📊",
        "color": "blue",
        "subtopics": [
            "Conceptual Framework & Standard Setting",
            "General-Purpose Financial Statement Preparation",
            "Disclosure Requirements",
            "Special Purpose Frameworks",
            "Not-for-Profit Accounting",
        ],
    },
    "Select Balance Sheet Accounts": {
        "order": 2,
        "icon": "💰",
        "color": "purple",
        "subtopics": [
            "Cash & Receivables",
            "Inventory Costing & Valuation",
            "Property, Plant & Equipment",
            "Intangible Assets & Goodwill",
            "Current & Long-Term Liabilities",
            "Stockholders' Equity",
        ],
    },
    "Select Transactions": {
        "order": 3,
        "icon": "🔄",
        "color": "green",
        "subtopics": [
            "Revenue Recognition (ASC 606)",
            "Leases (ASC 842)",
            "Accounting for Income Taxes",
            "Business Combinations & Consolidations",
            "Earnings Per Share",
            "Statement of Cash Flows",
        ],
    },
    "State & Local Governments": {
        "order": 4,
        "icon": "🏛️",
        "color": "amber",
        "subtopics": [
            "Fund Accounting Structure",
            "Government-Wide Financial Statements",
            "Budgetary Accounting",
            "Modified Accrual Basis",
        ],
    },
}

REG_CONTENT_MAP = {
    "Ethics, Professional Responsibilities & Federal Tax Procedures": {
        "order": 1,
        "icon": "⚖️",
        "color": "blue",
        "subtopics": [
            "Treasury Circular 230",
            "Tax Return Preparer Penalties",
            "IRS Audit & Appeals Procedures",
            "Federal Tax Legislative Process",
        ],
    },
    "Business Law": {
        "order": 2,
        "icon": "📜",
        "color": "purple",
        "subtopics": [
            "Contract Formation & Performance",
            "Agency Relationships",
            "Business Structures & Governance",
            "UCC — Sales & Secured Transactions",
            "Bankruptcy & Debtor-Creditor Relationships",
            "Federal Securities Regulation",
        ],
    },
    "Federal Taxation of Property Transactions": {
        "order": 3,
        "icon": "🏠",
        "color": "green",
        "subtopics": [
            "Basis of Property",
            "Gain/Loss Recognition & Character",
            "Like-Kind Exchanges & Involuntary Conversions",
            "Depreciation, Amortization & Cost Recovery",
        ],
    },
    "Federal Taxation of Individuals": {
        "order": 4,
        "icon": "🧾",
        "color": "amber",
        "subtopics": [
            "Gross Income Inclusions & Exclusions",
            "Adjustments & Itemized Deductions",
            "Tax Credits for Individuals",
            "Filing Status & Alternative Minimum Tax",
        ],
    },
    "Federal Taxation of Entities": {
        "order": 5,
        "icon": "🏢",
        "color": "red",
        "subtopics": [
            "C Corporation Taxation",
            "S Corporation Taxation",
            "Partnership Taxation",
            "Tax-Exempt Organizations",
        ],
    },
}

BAR_CONTENT_MAP = {
    "Business Analysis": {
        "order": 1,
        "icon": "📈",
        "color": "blue",
        "subtopics": [
            "Financial Statement Analysis",
            "Budgeting & Variance Analysis",
            "Financial Valuation Methods",
            "Enterprise Risk Management",
            "Managerial & Cost Accounting",
        ],
    },
    "Technical Accounting & Reporting": {
        "order": 2,
        "icon": "🧮",
        "color": "purple",
        "subtopics": [
            "Stock Compensation",
            "Derivatives & Hedge Accounting",
            "Advanced Business Combinations",
            "Complex Revenue Recognition",
            "Complex EPS Calculations",
        ],
    },
    "State & Local Governments (Advanced)": {
        "order": 3,
        "icon": "🏛️",
        "color": "green",
        "subtopics": [
            "Government Fund Financial Reporting",
            "Government-Wide Reconciliations",
            "Component Units & Reporting Entity",
        ],
    },
}

ISC_CONTENT_MAP = {
    "Information Systems & Data Management": {
        "order": 1,
        "icon": "🖥️",
        "color": "blue",
        "subtopics": [
            "IT Governance Frameworks",
            "Data Management & Data Governance",
            "System Development Lifecycle",
            "Business Process Controls",
        ],
    },
    "Security, Confidentiality & Privacy": {
        "order": 2,
        "icon": "🔒",
        "color": "purple",
        "subtopics": [
            "Access Controls & Authentication",
            "Cybersecurity Frameworks (NIST, COBIT)",
            "Data Privacy Regulations",
            "Incident Response & Business Continuity",
        ],
    },
    "Considerations for SOC Engagements": {
        "order": 3,
        "icon": "🛡️",
        "color": "green",
        "subtopics": [
            "SOC 1 / SOC 2 Report Types",
            "Trust Services Criteria",
            "IT Control Testing Approaches",
        ],
    },
}

TCP_CONTENT_MAP = {
    "Tax Compliance & Planning for Individuals": {
        "order": 1,
        "icon": "🧾",
        "color": "blue",
        "subtopics": [
            "Individual Tax Planning Strategies",
            "Retirement Plan Taxation",
            "Estate & Gift Tax Planning",
            "Personal Financial Planning",
        ],
    },
    "Entity Tax Compliance": {
        "order": 2,
        "icon": "🏢",
        "color": "purple",
        "subtopics": [
            "Entity Tax Return Preparation",
            "Entity Credits & Deductions",
            "Multistate Taxation Considerations",
        ],
    },
    "Entity Tax Planning": {
        "order": 3,
        "icon": "🗂️",
        "color": "green",
        "subtopics": [
            "Entity Choice & Structuring",
            "Corporate Reorganizations",
            "International Tax Considerations",
        ],
    },
    "Property Transactions": {
        "order": 4,
        "icon": "🏗️",
        "color": "amber",
        "subtopics": [
            "Tax Planning for Asset Dispositions",
            "Like-Kind Exchange Planning",
            "Installment Sales & Deferred Recognition",
        ],
    },
}

SUBJECT_CONFIGS = {
    "aud": {"content_map": AUD_CONTENT_MAP, "subject": "aud"},
    "far": {"content_map": FAR_CONTENT_MAP, "subject": "far"},
    "reg": {"content_map": REG_CONTENT_MAP, "subject": "reg"},
    "bar": {"content_map": BAR_CONTENT_MAP, "subject": "bar"},
    "isc": {"content_map": ISC_CONTENT_MAP, "subject": "isc"},
    "tcp": {"content_map": TCP_CONTENT_MAP, "subject": "tcp"},
}

PROBLEMS_PER_SUBTOPIC = 40


def _make_slug(name: str) -> str:
    return name.lower().replace(" ", "-").replace("(", "").replace(")", "").replace(",", "")


class ContentGenerationWorkflow(Workflow):
    name: str = "CPA Content Generation"
    description: str = "Generates topics, subtopics, and CPA exam problems"

    async def run_generation(self, subject: str = "aud") -> dict:
        """Execute the full content generation pipeline. Skips existing content."""
        config = SUBJECT_CONFIGS[subject]
        content_map = config["content_map"]
        subject_key = config["subject"]

        stats = {"topics": 0, "subtopics": 0, "problems": 0, "skipped_topics": 0, "skipped_subtopics": 0, "skipped_problems": 0}

        # ── Step 1: Generate Topics ──
        print(f"\n══════════════════════════════════════")
        print(f"  Step 1: Generating Topics ({subject})")
        print(f"══════════════════════════════════════\n")

        saved_topics = {}  # name -> {id, ...}
        topics_to_generate = []

        for topic_name, meta in content_map.items():
            slug = _make_slug(topic_name)
            existing = get_topic_by_slug(slug)
            if existing:
                saved_topics[topic_name] = existing
                stats["skipped_topics"] += 1
                print(f"  ⏭ Topic already exists: {topic_name} (id: {existing['id'][:8]}...)")
            else:
                topics_to_generate.append((topic_name, meta))

        if topics_to_generate:
            topic_tasks = [
                generate_topic(
                    name=name,
                    subtopics=meta["subtopics"],
                    order=meta["order"],
                    icon=meta["icon"],
                    color=meta["color"],
                    subject=subject_key,
                )
                for name, meta in topics_to_generate
            ]
            topic_results = await asyncio.gather(*topic_tasks)

            for topic_data in topic_results:
                saved = save_topic(topic_data)
                saved_topics[topic_data["name"]] = saved
                stats["topics"] += 1
                print(f"  ✓ Saved topic: {topic_data['name']} (id: {saved['id'][:8]}...)")

        # ── Step 2: Generate Subtopics ──
        print(f"\n══════════════════════════════════════")
        print(f"  Step 2: Generating Subtopics ({subject})")
        print(f"══════════════════════════════════════\n")

        saved_subtopics = {}  # (topic_name, subtopic_name) -> {id, ...}
        subtopics_to_generate = []

        for topic_name, meta in content_map.items():
            topic_id = saved_topics[topic_name]["id"]
            for i, sub_name in enumerate(meta["subtopics"]):
                slug = _make_slug(sub_name)
                existing = get_subtopic(topic_id, slug)
                if existing:
                    saved_subtopics[(topic_name, sub_name)] = existing
                    stats["skipped_subtopics"] += 1
                    print(f"  ⏭ [{topic_name}] {sub_name} (exists)")
                else:
                    subtopics_to_generate.append((topic_name, sub_name, topic_id, i, meta["subtopics"]))

        if subtopics_to_generate:
            sub_tasks = [
                generate_subtopic(
                    name=sub_name,
                    topic_name=topic_name,
                    topic_id=topic_id,
                    order_index=order_idx,
                    all_subtopic_names=all_subs,
                    subject=subject_key,
                )
                for topic_name, sub_name, topic_id, order_idx, all_subs in subtopics_to_generate
            ]
            sub_results = await asyncio.gather(*sub_tasks)

            for (topic_name, sub_name, *_), sub_data in zip(subtopics_to_generate, sub_results):
                saved = save_subtopic(sub_data)
                saved_subtopics[(topic_name, sub_name)] = saved
                stats["subtopics"] += 1
                print(f"  ✓ [{topic_name}] {sub_name} (id: {saved['id'][:8]}...)")

        # ── Step 3: Generate Problems ──
        print(f"\n══════════════════════════════════════")
        print(f"  Step 3: Generating CPA Problems ({subject})")
        print(f"══════════════════════════════════════\n")

        num_batches = PROBLEMS_PER_SUBTOPIC // BATCH_SIZE

        for topic_name, meta in content_map.items():
            print(f"\n  📚 {topic_name}")
            for sub_name in meta["subtopics"]:
                subtopic_id = saved_subtopics[(topic_name, sub_name)]["id"]
                existing_count = get_problem_count(subtopic_id)

                if existing_count >= PROBLEMS_PER_SUBTOPIC:
                    stats["skipped_problems"] += existing_count
                    print(f"    ⏭ {sub_name}: {existing_count} problems already exist")
                    continue

                # Figure out which batches still need generating
                batches_done = existing_count // BATCH_SIZE
                batches_remaining = num_batches - batches_done

                if batches_remaining <= 0:
                    stats["skipped_problems"] += existing_count
                    print(f"    ⏭ {sub_name}: {existing_count} problems already exist")
                    continue

                print(f"    📝 {sub_name} ({existing_count} exist, generating {batches_remaining * BATCH_SIZE} more): ", end="", flush=True)

                # Generate remaining batches in parallel
                batch_tasks = []
                for b in range(batches_done, num_batches):
                    batch_tasks.append(
                        generate_problems_batch(
                            subtopic_name=sub_name,
                            topic_name=topic_name,
                            subtopic_id=subtopic_id,
                            batch_number=b,
                            batch_size=BATCH_SIZE,
                            start_order_index=b * BATCH_SIZE,
                            subject=subject_key,
                        )
                    )

                batch_results = await asyncio.gather(*batch_tasks, return_exceptions=True)

                # Save successful batches, log failures
                total_saved = 0
                for result in batch_results:
                    if isinstance(result, Exception):
                        print(f"✗", end="", flush=True)
                    else:
                        try:
                            saved = save_problems(result)
                            total_saved += len(saved)
                            print(f"█", end="", flush=True)
                        except Exception as e:
                            print(f"✗", end="", flush=True)

                stats["problems"] += total_saved
                print(f" ({total_saved} problems)")

        return stats
