---
topic: how do these papers handle attention/alignment mechanisms
mode: synthesize
papers:
- '1706.03762'
- '1409.0473'
citation_labels:
  '1706.03762': Vaswani et al. 2017
  '1409.0473': Bahdanau et al. 2014
generated_at: '2026-07-16T08:42:45.873111+00:00'
extraction_method: claude-cli
---

Both papers address the problem of relating positions across a sequence, but they differ sharply in how central attention is to the overall architecture. Bahdanau et al. (2014) introduce attention as a targeted fix to a specific bottleneck: the fixed-length context vector of the RNN encoder-decoder degrades on long sentences, so they add a learned alignment model that lets the decoder compute a weighted combination of bidirectional-RNN annotations at each output step, effectively replacing a single fixed vector with a per-timestep soft-searched context (Bahdanau et al. 2014). Attention here is a supplementary mechanism layered on top of recurrence — the encoder and decoder are still RNNs, and the alignment weights are produced by a small feedforward network scoring decoder state against each source annotation (Bahdanau et al. 2014). Vaswani et al. (2017) take the opposite stance, arguing that if attention already lets a model draw dependencies between arbitrary positions regardless of distance, then recurrence is not merely optional but actively limiting, since it prevents within-sequence parallelization and caps computation to a fixed number of operations only in the attention case (Vaswani et al. 2017). The Transformer accordingly discards recurrence entirely and relies on scaled dot-product self-attention, computed in parallel across multiple learned projections ("multi-head attention") for encoder self-attention, decoder self-attention, and encoder-decoder attention alike (Vaswani et al. 2017).

This contrast reflects a broader trajectory from attention-as-addition to attention-as-foundation. Bahdanau et al.'s alignment mechanism demonstrates empirically that soft, differentiable alignment outperforms compressing a whole sentence into one vector, and that the resulting attention weights correspond to linguistically plausible word alignments (Bahdanau et al. 2014). Vaswani et al. generalize this insight into a full alignment substitute for sequential computation, showing that a purely attention-based architecture not only matches but exceeds RNN-based translation quality while training faster and generalizing to non-translation tasks such as constituency parsing (Vaswani et al. 2017). Where Bahdanau et al.'s alignment model is a single additive-attention computation between decoder state and encoder annotations, Vaswani et al.'s scaled dot-product formulation is explicitly framed as a faster, more space-efficient alternative to additive attention, with multi-head projection compensating for the loss of resolution that a single attention function would otherwise incur (Vaswani et al. 2017).
