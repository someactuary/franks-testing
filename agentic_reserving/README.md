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
