# Agentic Reserving

This experiment explores how AI agents can support actuarial loss reserving.

Reserving is a useful test case for agentic AI because it combines structured calculations with data validation, method selection, diagnostics, documentation, and substantial actuarial judgment. A useful reserving agent must do more than produce a number: it should explain its work, identify uncertainty, and make it easy for an actuary to review the result.

## Objectives

The experiment is intended to evaluate whether an AI agent can help:

- inspect and validate reserving data;
- identify anomalies or potential data-quality issues;
- construct and analyze loss-development triangles;
- apply appropriate reserving methods;
- compare results across methods and assumptions;
- produce diagnostics and supporting exhibits;
- explain its reasoning and flag judgment-dependent decisions; and
- create a reproducible record of the analysis.

## Folder Structure

```text
agentic_reserving/
├── README.md   # Project overview, folder guide, and intended workflow
├── assets/     # Original reference PDFs obtained from the web
├── notes/      # Plain-text extracts of the reference PDFs
├── analysis/   # Python scripts for calculations, checks, and workpaper creation
└── outputs/    # Generated results, summaries, and Excel workpaper
```

### `assets/` — Original reference documents

These files come from the web and provide the source material for the experiment:

- `PGR-Q4-2025-10K (see page 100+).pdf`: Progressive's 2025 Form 10-K, including the loss-development disclosures used in the commercial auto liability analysis.
- `studynotes_friedland_estimating.pdf`: An extract from Jacqueline Friedland's reserving textbook, *Estimating Unpaid Claims Using Basic Techniques*, used for CAS Exam 5. Its worked examples provide reference calculations for testing reserving methods.

### `notes/` — Text extracted from the assets

`pgr_2025_10k_extracted.txt` and `friedland_extracted.txt` are the plain-text extracts of the corresponding PDFs in `assets/`. They make the source material easier to search and inspect. Refer back to the PDFs when checking table layout, formatting, or numerical values.

### `analysis/` — Calculation and workpaper scripts

- `smoke_test.py`: Reproduces selected reported and paid chain-ladder and Bornhuetter–Ferguson examples from Friedland and compares the calculations with the printed exhibit values.
- `pgr_commercial_auto_liability_estimate.py`: Calculates illustrative Bornhuetter–Ferguson ultimate-loss ranges for Progressive's commercial auto liability business using source values and selected premium-allocation and expected-loss-ratio assumptions.
- `build_actuarial_workpaper.py`: Builds an Excel workpaper containing source data, incurred and paid triangles, development factors, Bornhuetter–Ferguson calculations, reserve summaries, and quality-control checks.

The scripts currently contain hardcoded source values and assumptions; they do not automatically parse the files in `notes/`. They also retain an absolute project path from the original environment, which must be updated before running them elsewhere.

### `outputs/` — Generated deliverables

- `smoke_test_results.json` and `smoke_test_summary.md`: Calculation comparisons against the Friedland examples, in machine-readable and human-readable formats.
- `pgr_commercial_auto_liability_estimates.json` and `pgr_commercial_auto_liability_estimates.md`: Progressive estimate ranges, assumptions, and a written summary.
- `progressive_commercial_auto_liability_workpaper.xlsx`: The Excel workpaper produced by `build_actuarial_workpaper.py` for review of the supporting calculations.

The overall flow is **reference PDFs → searchable text extracts → analysis scripts → generated deliverables**, with source values currently transferred into the scripts explicitly rather than through an automated extraction pipeline.

## Intended Workflow

A complete agentic reserving workflow might include:

1. **Understand the assignment**  
   Identify the available data, requested valuation date, relevant measures, and desired outputs.

2. **Validate the data**  
   Check dimensions, reconciliations, missing values, development periods, diagonals, and potentially unusual observations.

3. **Perform exploratory analysis**  
   Review development patterns, changes in mix, calendar-period effects, and other features that could affect method selection.

4. **Estimate ultimate losses**  
   Apply one or more actuarial methods, such as chain ladder, Bornhuetter–Ferguson, expected-loss-ratio, or other appropriate techniques.

5. **Evaluate the results**  
   Compare methods, test assumptions, examine diagnostics, and identify areas requiring actuarial judgment.

6. **Produce outputs**  
   Generate tables, visualizations, explanations, and a record of the assumptions and decisions used in the analysis.

## Role of the Actuary

The goal is not to remove the actuary from the process. The agent should make routine work faster and analysis more reproducible while keeping material judgments visible to a qualified reviewer.

Human review is especially important for:

- selecting methods and assumptions;
- interpreting operational or business changes;
- evaluating unusual observations;
- determining whether historical development remains predictive;
- selecting a final reserve; and
- approving any external or financial reporting.

## Evaluation Questions

This experiment is also meant to test:

- Are the calculations correct and reproducible?
- Does the agent recognize incomplete or inconsistent data?
- Does it distinguish calculated results from actuarial judgment?
- Can another actuary understand and audit its work?
- Does it communicate uncertainty without overstating confidence?
- How sensitive are its conclusions to prompts, models, and available context?
- Where should deterministic code replace—or constrain—model reasoning?

## Current Status

This project is experimental and under active development. Features, prompts, workflow design, and outputs may change as the approach is tested.

## Limitations and Disclaimer

This project is intended for research, experimentation, and education. It is not a production reserving system, and its outputs do not constitute an actuarial opinion.

AI-generated calculations and conclusions may be incomplete or incorrect. All results should be independently validated and reviewed by a qualified actuary before being used in financial reporting, regulatory filings, pricing, capital decisions, or other consequential applications.
