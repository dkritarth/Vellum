---
topic: how is transfer learning / pretraining used across these papers
mode: synthesize
papers:
- 10-1371-journal-pone-0130140
- '1409.0473'
- '1512.03385'
- '1706.03762'
- '1810.04805'
citation_labels:
  10-1371-journal-pone-0130140: Bach et al. 2015
  '1409.0473': Bahdanau et al. 2014
  '1512.03385': He et al. 2015
  '1706.03762': Vaswani et al. 2017
  '1810.04805': Devlin et al. 2018
generated_at: '2026-07-16T08:43:06.936185+00:00'
extraction_method: claude-cli
---

Across these five papers, transfer learning and pretraining emerge as a central technique specifically in the language and vision papers, while the interpretability and translation-architecture papers use pretrained models only as objects of analysis or as a stated limitation to be addressed. Devlin et al. (2018) makes pretraining the paper's core contribution, distinguishing between the feature-based approach exemplified by ELMo, which incorporates pretrained representations as additional task-specific features, and the fine-tuning approach exemplified by OpenAI GPT, in which nearly all parameters are initialized from a pretrained model and then adapted end to end on the downstream task; BERT extends this second paradigm by introducing a masked language model objective that enables bidirectional pretraining, which the authors argue is what allows a single pretrained architecture to transfer effectively to both sentence-level and token-level tasks with minimal architecture change (Devlin et al. 2018). Devlin et al. (2018) explicitly situates this within a longer history of transfer learning in NLP, citing prior work in unsupervised feature-based pretraining of word embeddings as well as supervised transfer from tasks such as natural language inference and machine translation, and it further draws an analogy to computer vision, noting that fine-tuning models pretrained on ImageNet had already established the value of large-scale pretrained representations in that domain (Devlin et al. 2018) — a parallel made concrete by He et al. (2015), whose deep residual networks, pretrained on ImageNet, are shown to transfer well to other recognition tasks such as COCO object detection, yielding substantial accuracy gains from representations learned at very large depth (He et al. 2015).

By contrast, Bach et al. (2015) treats a pretrained classifier not as a technique to be extended but as a fixed artifact to be explained: the paper evaluates its layer-wise relevance propagation method on an already pretrained ImageNet model from the Caffe package, explicitly noting that its contribution is not about classifier training and that the proposed methods are built on top of, and applicable to, an already pretrained classifier (Bach et al. 2015). Bahdanau et al. (2014) and Vaswani et al. (2017), meanwhile, address transfer learning only tangentially: Bahdanau et al. (2014) trains its RNN-based encoder–decoder models from scratch on parallel corpora, though it briefly notes that pretraining an encoder on a larger monolingual corpus might be possible and beneficial, without pursuing this further, while Vaswani et al. (2017) similarly trains the Transformer from scratch for translation and parsing rather than employing any pretraining step — a gap later exploited by Devlin et al. (2018), which adopts the Transformer encoder architecture from Vaswani et al. (2017) as the backbone for its own pretraining framework.
