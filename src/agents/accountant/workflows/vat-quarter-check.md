# VAT Quarter Check

1. Confirm the VAT quarter dates from the company's stagger, and get the due date from `accounting.ukDeadlines`.
2. Summarize the ledger export for that quarter with `accounting.summarizeLedger`, grouped by account or tax rate if the export has one.
3. Check for: sales or purchases dated outside the quarter, duplicates, zero-rated or exempt items coded as standard-rated, VAT claimed on entertainment or cars, and missing supplier invoices for large purchases.
4. Present the findings as a checklist with row numbers. Do not produce final VAT return box figures unless the export contains VAT amounts per line; if it does, show how each box was built.
5. Remind the user that the return is submitted from their MTD software, not from here.
