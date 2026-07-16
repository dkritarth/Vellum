---
topic: is recurrence necessary for good sequence modeling performance
mode: contradictions
papers:
- '1706.03762'
- '1409.0473'
- '1810.04805'
citation_labels:
  '1706.03762': Vaswani et al. 2017
  '1409.0473': Bahdanau et al. 2014
  '1810.04805': Devlin et al. 2018
generated_at: '2026-07-16T08:43:22.124747+00:00'
extraction_method: claude-cli
---

Agreement: All three papers agree recurrence not strictly required for strong sequence modeling. Vaswani et al. 2017 drop recurrence and convolution entirely, get better BLEU than RNN-based systems at lower training cost. Devlin et al. 2018 build BERT on pure Transformer (no recurrence), beat prior feature-based/fine-tuning approaches including ELMo (which use LSTMs).

Disagreement: Bahdanau et al. 2014 do not challenge recurrence itself — they keep RNN encoder-decoder core, just add attention to fix fixed-length-vector bottleneck. So no direct disagreement on necessity-of-recurrence claim; Bahdanau et al. simply predates that question, still recurrence-based, while Vaswani et al. and Devlin et al. actively argue against needing it. Position, not contradiction: recurrence-optional (Vaswani, Devlin) vs recurrence-retained-but-improved (Bahdanau).
