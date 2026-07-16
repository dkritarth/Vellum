|     | BERT:       |     | Pre-training |               |          | of Deep | Bidirectional |           | Transformers      |     | for |     |
| --- | ----------- | --- | ------------ | ------------- | -------- | ------- | ------------- | --------- | ----------------- | --- | --- | --- |
|     |             |     |              |               | Language |         | Understanding |           |                   |     |     |     |
|     | JacobDevlin |     |              | Ming-WeiChang |          |         |               | KentonLee | KristinaToutanova |     |     |     |
GoogleAILanguage
{jacobdevlin,mingweichang,kentonl,kristout}@google.com
|     |           |     | Abstract |          |             |     |     | There                  | are two existing |                 | strategies       | for apply- |
| --- | --------- | --- | -------- | -------- | ----------- | --- | --- | ---------------------- | ---------------- | --------------- | ---------------- | ---------- |
|     |           |     |          |          |             |     |     | ingpre-trainedlanguage |                  | representations |                  | todown-    |
| We  | introduce |     | a new    | language | representa- |     |     |                        |                  |                 |                  |            |
|     |           |     |          |          |             |     |     | stream tasks:          | feature-based    |                 | and fine-tuning. | The        |
9102 yaM 42  ]LC.sc[  2v50840.0181:viXra BERT,
| tion          | model | called  |     | which           | stands | for  |     |               |           |      |         |         |
| ------------- | ----- | ------- | --- | --------------- | ------ | ---- | --- | ------------- | --------- | ---- | ------- | ------- |
|               |       |         |     |                 |        |      |     | feature-based | approach, | such | as ELMo | (Peters |
| Bidirectional |       | Encoder |     | Representations |        | from |     |               |           |      |         |         |
Transformers. Unlike recent language repre- et al., 2018a), uses task-specific architectures that
sentation models (Peters et al., 2018a; Rad- include the pre-trained representations as addi-
ford et al., 2018), BERT is designed to pre- tional features. The fine-tuning approach, such as
| train | deep | bidirectional |     | representations |     | from |     |                |             |     |             |         |
| ----- | ---- | ------------- | --- | --------------- | --- | ---- | --- | -------------- | ----------- | --- | ----------- | ------- |
|       |      |               |     |                 |     |      |     | the Generative | Pre-trained |     | Transformer | (OpenAI |
unlabeledtextbyjointlyconditioningonboth
|      |     |               |     |        |         |          |     | GPT) (Radford | et al.,     | 2018), | introduces | minimal |
| ---- | --- | ------------- | --- | ------ | ------- | -------- | --- | ------------- | ----------- | ------ | ---------- | ------- |
| left | and | right context |     | in all | layers. | As a re- |     |               |             |        |            |         |
|      |     |               |     |        |         |          |     | task-specific | parameters, | and    | is trained | on the  |
sult,thepre-trainedBERTmodelcanbefine-
|       |      |      |     |            |        |       |     | downstream | tasks by | simply | fine-tuning | all pre- |
| ----- | ---- | ---- | --- | ---------- | ------ | ----- | --- | ---------- | -------- | ------ | ----------- | -------- |
| tuned | with | just | one | additional | output | layer |     |            |          |        |             |          |
to create state-of-the-art models for a wide trainedparameters. Thetwoapproachessharethe
rangeoftasks,suchasquestionansweringand sameobjectivefunctionduringpre-training,where
language inference, without substantial task- they use unidirectional language models to learn
specificarchitecturemodifications. generallanguagerepresentations.
BERT is conceptually simple and empirically We argue that current techniques restrict the
powerful. It obtains new state-of-the-art re- power of the pre-trained representations, espe-
sults on eleven natural language processing cially for the fine-tuning approaches. The ma-
| tasks, | including |     | pushing | the | GLUE | score to |     |     |     |     |     |     |
| ------ | --------- | --- | ------- | --- | ---- | -------- | --- | --- | --- | --- | --- | --- |
jorlimitationisthatstandardlanguagemodelsare
| 80.5%    | (7.7% | point    | absolute |       | improvement), |          |     |                 |                  |        |               |           |
| -------- | ----- | -------- | -------- | ----- | ------------- | -------- | --- | --------------- | ---------------- | ------ | ------------- | --------- |
|          |       |          |          |       |               |          |     | unidirectional, | and this         | limits | the choice    | of archi- |
| MultiNLI |       | accuracy | to       | 86.7% | (4.6%         | absolute |     |                 |                  |        |               |           |
|          |       |          |          |       |               |          |     | tectures        | that can be used | during | pre-training. | For       |
improvement),SQuADv1.1questionanswer-
example,inOpenAIGPT,theauthorsusealeft-to-
| ing | Test | F1 to | 93.2 (1.5 | point | absolute | im- |     |     |     |     |     |     |
| --- | ---- | ----- | --------- | ----- | -------- | --- | --- | --- | --- | --- | --- | --- |
provement) and SQuAD v2.0 Test F1 to 83.1 right architecture, where every token can only at-
(5.1pointabsoluteimprovement). tendtoprevioustokensintheself-attentionlayers
|     |     |     |     |     |     |     |     | oftheTransformer(Vaswanietal.,2017). |     |     |     | Suchre- |
| --- | --- | --- | --- | --- | --- | --- | --- | ------------------------------------ | --- | --- | --- | ------- |
1 Introduction
strictionsaresub-optimalforsentence-leveltasks,
Language model pre-training has been shown to and could be very harmful when applying fine-
be effective for improving many natural language tuningbasedapproachestotoken-leveltaskssuch
processing tasks (Dai and Le, 2015; Peters et al., asquestionanswering,whereitiscrucialtoincor-
2018a; Radford et al., 2018; Howard and Ruder, poratecontextfrombothdirections.
2018). Theseincludesentence-leveltaskssuchas In this paper, we improve the fine-tuning based
natural language inference (Bowman et al., 2015; approaches by proposing BERT: Bidirectional
Williams et al., 2018) and paraphrasing (Dolan Encoder Representations from Transformers.
and Brockett, 2005), which aim to predict the re- BERT alleviates the previously mentioned unidi-
lationships between sentences by analyzing them rectionality constraint by using a “masked lan-
holistically, as well as token-level tasks such as guage model” (MLM) pre-training objective, in-
namedentityrecognitionandquestionanswering, spired by the Cloze task (Taylor, 1953). The
wheremodelsarerequiredtoproducefine-grained maskedlanguagemodelrandomlymaskssomeof
output at the token level (Tjong Kim Sang and the tokens from the input, and the objective is to
DeMeulder,2003;Rajpurkaretal.,2016). predict the original vocabulary id of the masked

word based only on its context. Unlike left-to- These approaches have been generalized to
right language model pre-training, the MLM ob- coarser granularities, such as sentence embed-
jective enables the representation to fuse the left dings (Kiros et al., 2015; Logeswaran and Lee,
and the right context, which allows us to pre- 2018)orparagraphembeddings(LeandMikolov,
train a deep bidirectional Transformer. In addi- 2014). To train sentence representations, prior
tion to the masked language model, we also use work has used objectives to rank candidate next
a “next sentence prediction” task that jointly pre- sentences (Jernite et al., 2017; Logeswaran and
trains text-pair representations. The contributions Lee, 2018), left-to-right generation of next sen-
ofourpaperareasfollows: tencewordsgivenarepresentationoftheprevious
|     |     |     |     |     |     | sentence | (Kiros | et al., | 2015), | or denoising |     | auto- |
| --- | --- | --- | --- | --- | --- | -------- | ------ | ------- | ------ | ------------ | --- | ----- |
• Wedemonstratetheimportanceofbidirectional
encoderderivedobjectives(Hilletal.,2016).
| pre-training | for language |     | representations. |     | Un- |      |     |                 |     |         |         |       |
| ------------ | ------------ | --- | ---------------- | --- | --- | ---- | --- | --------------- | --- | ------- | ------- | ----- |
|              |              |     |                  |     |     | ELMo | and | its predecessor |     | (Peters | et al., | 2017, |
likeRadfordetal.(2018),whichusesunidirec-
|                 |          |     |                   |           |      | 2018a)       | generalize | traditional | word       | embedding |      | re-     |
| --------------- | -------- | --- | ----------------- | --------- | ---- | ------------ | ---------- | ----------- | ---------- | --------- | ---- | ------- |
| tional language | models   |     | for pre-training, |           | BERT |              |            |             |            |           |      |         |
|                 |          |     |                   |           |      | search along | a          | different   | dimension. |           | They | extract |
| uses masked     | language |     | models            | to enable | pre- |              |            |             |            |           |      |         |
context-sensitivefeaturesfromaleft-to-rightanda
| traineddeep | bidirectionalrepresentations. |     |     |     | This |               |          |     |        |                |     |      |
| ----------- | ----------------------------- | --- | --- | --- | ---- | ------------- | -------- | --- | ------ | -------------- | --- | ---- |
|             |                               |     |     |     |      | right-to-left | language |     | model. | The contextual |     | rep- |
isalsoincontrasttoPetersetal.(2018a),which
|                |               |     |     |               |     | resentation       | of  | each token        | is the | concatenation    |     | of  |
| -------------- | ------------- | --- | --- | ------------- | --- | ----------------- | --- | ----------------- | ------ | ---------------- | --- | --- |
| uses a shallow | concatenation |     | of  | independently |     |                   |     |                   |        |                  |     |     |
|                |               |     |     |               |     | the left-to-right |     | and right-to-left |        | representations. |     |     |
trainedleft-to-rightandright-to-leftLMs.
|     |     |     |     |     |     | When | integrating | contextual |     | word | embeddings |     |
| --- | --- | --- | --- | --- | --- | ---- | ----------- | ---------- | --- | ---- | ---------- | --- |
• Weshowthatpre-trainedrepresentationsreduce with existing task-specific architectures, ELMo
the need for many heavily-engineered task- advancesthestateoftheartforseveralmajorNLP
specific architectures. BERT is the first fine- benchmarks (Peters et al., 2018a) including ques-
tuningbasedrepresentationmodelthatachieves tionanswering(Rajpurkaretal.,2016),sentiment
state-of-the-art performance on a large suite analysis (Socher et al., 2013), and named entity
of sentence-level and token-level tasks, outper- recognition (Tjong Kim Sang and De Meulder,
formingmanytask-specificarchitectures. 2003). Melamud et al. (2016) proposed learning
|                 |     |           |        |         |        | contextual | representations |     | through |     | a task | to pre- |
| --------------- | --- | --------- | ------ | ------- | ------ | ---------- | --------------- | --- | ------- | --- | ------ | ------- |
| • BERT advances |     | the state | of the | art for | eleven |            |                 |     |         |     |        |         |
dictasinglewordfrombothleftandrightcontext
| NLP tasks. | The | code | and pre-trained |     | mod- |              |     |         |          |       |       |     |
| ---------- | --- | ---- | --------------- | --- | ---- | ------------ | --- | ------- | -------- | ----- | ----- | --- |
|            |     |      |                 |     |      | using LSTMs. |     | Similar | to ELMo, | their | model | is  |
elsareavailableathttps://github.com/
|     |     |     |     |     |     | feature-based |     | and not | deeply | bidirectional. |     | Fedus |
| --- | --- | --- | --- | --- | --- | ------------- | --- | ------- | ------ | -------------- | --- | ----- |
google-research/bert.
etal.(2018)showsthattheclozetaskcanbeused
toimprovetherobustnessoftextgenerationmod-
2 RelatedWork
els.
Thereisalonghistoryofpre-traininggenerallan-
| guage representations, |     | and | we briefly | review | the |                                       |     |     |     |     |     |     |
| ---------------------- | --- | --- | ---------- | ------ | --- | ------------------------------------- | --- | --- | --- | --- | --- | --- |
|                        |     |     |            |        |     | 2.2 UnsupervisedFine-tuningApproaches |     |     |     |     |     |     |
mostwidely-usedapproachesinthissection.
|     |     |     |     |     |     | As with | the feature-based |     | approaches, |     | the | first |
| --- | --- | --- | --- | --- | --- | ------- | ----------------- | --- | ----------- | --- | --- | ----- |
2.1 UnsupervisedFeature-basedApproaches
|          |        |            |                 |     |     | works in | this direction |      | only pre-trained |     | word | em-   |
| -------- | ------ | ---------- | --------------- | --- | --- | -------- | -------------- | ---- | ---------------- | --- | ---- | ----- |
|          |        |            |                 |     |     | bedding  | parameters     | from | unlabeled        |     | text | (Col- |
| Learning | widely | applicable | representations |     | of  |          |                |      |                  |     |      |       |
words has been an active area of research for lobertandWeston,2008).
decades,includingnon-neural(Brownetal.,1992; More recently, sentence or document encoders
Ando and Zhang, 2005; Blitzer et al., 2006) and which produce contextual token representations
neural (Mikolov et al., 2013; Pennington et al., have been pre-trained from unlabeled text and
2014) methods. Pre-trained word embeddings fine-tuned for a supervised downstream task (Dai
are an integral part of modern NLP systems, of- and Le, 2015; Howard and Ruder, 2018; Radford
fering significant improvements over embeddings et al., 2018). The advantage of these approaches
learnedfromscratch(Turianetal.,2010). Topre- is that few parameters need to be learned from
train word embedding vectors, left-to-right lan- scratch. At least partly due to this advantage,
guage modeling objectives have been used (Mnih OpenAIGPT(Radfordetal.,2018)achievedpre-
and Hinton, 2009), as well as objectives to dis- viously state-of-the-art results on many sentence-
criminate correct from incorrect words in left and level tasks from the GLUE benchmark (Wang
rightcontext(Mikolovetal.,2013). et al., 2018a). Left-to-right language model-

NSP Mask LM Mask LM MNLI NER SQuAD Start/End Span
C T ... T T T’ ... T ’ C T ... T T T’ ... T ’
1 N [SEP] 1 M 1 N [SEP] 1 M
BERT BERT BERT
E[CLS] E
1
... E
N
E
[SEP]
E
1
’ ... E
M
’ E[CLS] E
1
... E
N
E
[SEP]
E
1
’ ... E
M
’
[CLS] Tok 1 ... Tok N [SEP] Tok 1 ... TokM [CLS] Tok 1 ... Tok N [SEP] Tok 1 ... TokM
Masked Sentence A Masked Sentence B Question Paragraph
Unlabeled Sentence A and B Pair Question Answer Pair
Pre-training Fine-Tuning
Figure1: Overallpre-trainingandfine-tuningproceduresforBERT.Apartfromoutputlayers,thesamearchitec-
turesareusedinbothpre-trainingandfine-tuning. Thesamepre-trainedmodelparametersareusedtoinitialize
models for different down-stream tasks. During fine-tuning, all parameters are fine-tuned. [CLS] is a special
symbol added in front of every input example, and [SEP] is a special separator token (e.g. separating ques-
tions/answers).
ing and auto-encoder objectives have been used mal difference between the pre-trained architec-
for pre-training such models (Howard and Ruder, tureandthefinaldownstreamarchitecture.
2018;Radfordetal.,2018;DaiandLe,2015).
Model Architecture BERT’s model architec-
2.3 TransferLearningfromSupervisedData tureisamulti-layerbidirectionalTransformeren-
coder based on the original implementation de-
Therehasalsobeenworkshowingeffectivetrans-
scribed in Vaswani et al. (2017) and released in
ferfromsupervisedtaskswithlargedatasets,such
the tensor2tensor library.1 Because the use
as natural language inference (Conneau et al.,
ofTransformershasbecomecommonandourim-
2017) and machine translation (McCann et al.,
plementation is almost identical to the original,
2017). Computervisionresearchhasalsodemon-
we will omit an exhaustive background descrip-
strated the importance of transfer learning from
tionofthemodelarchitectureandreferreadersto
largepre-trainedmodels,whereaneffectiverecipe
Vaswani et al. (2017) as well as excellent guides
is to fine-tune models pre-trained with Ima-
suchas“TheAnnotatedTransformer.”2
geNet(Dengetal.,2009;Yosinskietal.,2014).
In this work, we denote the number of layers
3 BERT (i.e., Transformerblocks)asL, thehiddensizeas
H, and the number of self-attention heads as A.3
We introduce BERT and its detailed implementa-
We primarily report results on two model sizes:
tion in this section. There are two steps in our BERT (L=12, H=768, A=12, Total Param-
BASE
framework: pre-training and fine-tuning. Dur- eters=110M) and BERT (L=24, H=1024,
LARGE
ingpre-training,themodelistrainedonunlabeled
A=16,TotalParameters=340M).
data over different pre-training tasks. For fine-
BERT waschosentohavethesamemodel
BASE
tuning, the BERT model is first initialized with
size as OpenAI GPT for comparison purposes.
the pre-trained parameters, and all of the param-
Critically, however, the BERT Transformer uses
eters are fine-tuned using labeled data from the
bidirectional self-attention, while the GPT Trans-
downstreamtasks. Eachdownstreamtaskhassep-
formerusesconstrainedself-attentionwhereevery
arate fine-tuned models, eventhough theyare ini- tokencanonlyattendtocontexttoitsleft.4
tializedwiththesamepre-trainedparameters. The
question-answeringexampleinFigure1willserve 1https://github.com/tensorflow/tensor2tensor
asarunningexampleforthissection.
2http://nlp.seas.harvard.edu/2018/04/03/attention.html
3Inallcaseswesetthefeed-forward/filtersizetobe4H,
A distinctive feature of BERT is its unified ar-
i.e.,3072fortheH =768and4096fortheH =1024.
chitecture across different tasks. There is mini- 4We note that in the literature the bidirectional Trans-

Input/OutputRepresentations TomakeBERT Inordertotrainadeepbidirectionalrepresenta-
handle a variety of down-stream tasks, our input tion,wesimplymasksomepercentageoftheinput
representation is able to unambiguously represent tokens at random, and then predict those masked
both a single sentence and a pair of sentences tokens. We refer to this procedure as a “masked
(e.g.,(cid:104)Question,Answer(cid:105))inonetokensequence. LM” (MLM), although it is often referred to as a
Throughoutthiswork,a“sentence”canbeanarbi- Cloze task in the literature (Taylor, 1953). In this
traryspanofcontiguoustext,ratherthananactual case,thefinalhiddenvectorscorrespondingtothe
linguisticsentence. A“sequence”referstothein- mask tokens are fed into an output softmax over
puttokensequencetoBERT,whichmaybeasin- the vocabulary, as in a standard LM. In all of our
glesentenceortwosentencespackedtogether. experiments, we mask 15% of all WordPiece to-
We use WordPiece embeddings (Wu et al., kens in each sequence at random. In contrast to
2016) with a 30,000 token vocabulary. The first denoisingauto-encoders(Vincentetal.,2008),we
token of every sequence is always a special clas- only predict the masked words rather than recon-
sification token ([CLS]). The final hidden state structingtheentireinput.
corresponding to this token is used as the ag- Although this allows us to obtain a bidirec-
gregate sequence representation for classification tional pre-trained model, a downside is that we
|                 |     |       |            |          |     |        | are creating | a   | mismatch | between |     | pre-training | and |
| --------------- | --- | ----- | ---------- | -------- | --- | ------ | ------------ | --- | -------- | ------- | --- | ------------ | --- |
| tasks. Sentence |     | pairs | are packed | together |     | into a |              |     |          |         |     |              |     |
singlesequence. Wedifferentiatethesentencesin fine-tuning,sincethe[MASK]tokendoesnotap-
two ways. First, we separate them with a special pear during fine-tuning. To mitigate this, we do
token([SEP]).Second,weaddalearnedembed-
|     |     |     |     |     |     |     | not always | replace | “masked” |     | words | with | the ac- |
| --- | --- | --- | --- | --- | --- | --- | ---------- | ------- | -------- | --- | ----- | ---- | ------- |
ding to every token indicating whether it belongs tual [MASK] token. The training data generator
tosentenceAorsentenceB.AsshowninFigure1, chooses15%ofthetokenpositionsatrandomfor
wedenoteinputembeddingasE,thefinalhidden prediction. If the i-th token is chosen, we replace
vector of the special [CLS] token as C ∈ RH, thei-th token with (1) the[MASK]token 80% of
and the final hidden vector for the ith input token the time (2) a random token 10% of the time (3)
RH.
| asT ∈ |     |     |     |     |     |     | the unchanged |     | i-th token | 10% | of  | the time. | Then, |
| ----- | --- | --- | --- | --- | --- | --- | ------------- | --- | ---------- | --- | --- | --------- | ----- |
i
|       |       |        |           |                |     |     | T will | be used | to predict |     | the original | token | with |
| ----- | ----- | ------ | --------- | -------------- | --- | --- | ------ | ------- | ---------- | --- | ------------ | ----- | ---- |
| For a | given | token, | its input | representation |     | is  | i      |         |            |     |              |       |      |
constructedbysummingthecorrespondingtoken, cross entropy loss. We compare variations of this
segment, and position embeddings. A visualiza- procedureinAppendixC.2.
tionofthisconstructioncanbeseeninFigure2.
|     |     |     |     |     |     |     | Task #2: | Next | Sentence |     | Prediction |     | (NSP) |
| --- | --- | --- | --- | --- | --- | --- | -------- | ---- | -------- | --- | ---------- | --- | ----- |
3.1 Pre-trainingBERT Many important downstream tasks such as Ques-
Unlike Peters et al. (2018a) and Radford et al. tionAnswering(QA)andNaturalLanguageInfer-
|               |              |         |             |               |              |       | ence (NLI)      | are     | based       | on          | understanding |          | the rela-  |
| ------------- | ------------ | ------- | ----------- | ------------- | ------------ | ----- | --------------- | ------- | ----------- | ----------- | ------------- | -------- | ---------- |
| (2018),       | we do        | not use | traditional | left-to-right |              | or    |                 |         |             |             |               |          |            |
|               |              |         |             |               |              |       | tionship        | between | two         | sentences,  |               | which    | is not di- |
| right-to-left | language     |         | models      | to pre-train  |              | BERT. |                 |         |             |             |               |          |            |
|               |              |         |             |               |              |       | rectly captured |         | by language |             | modeling.     |          | In order   |
| Instead,      | we pre-train |         | BERT        | using         | two unsuper- |       |                 |         |             |             |               |          |            |
|               |              |         |             |               |              |       | to train        | a model | that        | understands |               | sentence | rela-      |
| vised tasks,  | described    |         | in this     | section.      | This         | step  |                 |         |             |             |               |          |            |
|               |              |         |             |               |              |       | tionships,      | we      | pre-train   | for         | a binarized   |          | next sen-  |
ispresentedintheleftpartofFigure1.
|          |        |     |              |     |       |         | tence prediction |     | task        | that | can be  | trivially     | gener- |
| -------- | ------ | --- | ------------ | --- | ----- | ------- | ---------------- | --- | ----------- | ---- | ------- | ------------- | ------ |
| Task #1: | Masked | LM  | Intuitively, |     | it is | reason- |                  |     |             |      |         |               |        |
|          |        |     |              |     |       |         | ated from        | any | monolingual |      | corpus. | Specifically, |        |
able to believe that a deep bidirectional model is whenchoosingthesentencesAandBforeachpre-
strictly more powerful than either a left-to-right training example, 50% of the time B is the actual
model or the shallow concatenation of a left-to- next sentence that follows A (labeled as IsNext),
right and a right-to-left model. Unfortunately, and 50% of the time it is a random sentence from
standardconditionallanguagemodelscanonlybe the corpus (labeled as NotNext). As we show
trained left-to-right or right-to-left, since bidirec- in Figure 1, C is used for next sentence predic-
| tional conditioning |     | would | allow | each | word | to in- | (NSP).5 |     |         |     |             |     |        |
| ------------------- | --- | ----- | ----- | ---- | ---- | ------ | ------- | --- | ------- | --- | ----------- | --- | ------ |
|                     |     |       |       |      |      |        | tion    |     | Despite | its | simplicity, | we  | demon- |
directly “see itself”, and the model could trivially strate in Section 5.1 that pre-training towards this
predictthetargetwordinamulti-layeredcontext. task is very beneficial to both QA and NLI. 6
formerisoftenreferredtoasa“Transformerencoder”while 5Thefinalmodelachieves97%-98%accuracyonNSP.
theleft-context-onlyversionisreferredtoasa“Transformer 6ThevectorCisnotameaningfulsentencerepresentation
decoder”sinceitcanbeusedfortextgeneration. withoutfine-tuning,sinceitwastrainedwithNSP.

Input [CLS] my dog is cute [SEP] he likes play ##ing [SEP]
Token
E E E E E E E E E E E
Embeddings [CLS] my dog is cute [SEP] he likes play ##ing [SEP]
Segment
E E E E E E E E E E E
Embeddings A A A A A A B B B B B
Position
E E E E E E E E E E E
Embeddings 0 1 2 3 4 5 6 7 8 9 10
Figure2: BERTinputrepresentation. Theinputembeddingsarethesumofthetokenembeddings,thesegmenta-
tionembeddingsandthepositionembeddings.
The NSP task is closely related to representation- (4) a degenerate text-∅ pair in text classification
learningobjectivesusedinJerniteetal.(2017)and orsequencetagging. Attheoutput,thetokenrep-
Logeswaran and Lee (2018). However, in prior resentationsarefedintoanoutputlayerfortoken-
work,onlysentenceembeddingsaretransferredto level tasks, such as sequence tagging or question
down-stream tasks, where BERT transfers all pa- answering, and the [CLS] representation is fed
rameterstoinitializeend-taskmodelparameters. into an output layer for classification, such as en-
tailmentorsentimentanalysis.
Pre-training data The pre-training procedure
Compared to pre-training, fine-tuning is rela-
largely follows the existing literature on language
tively inexpensive. All of the results in the pa-
modelpre-training. Forthepre-trainingcorpuswe
per can be replicated in at most 1 hour on a sin-
use the BooksCorpus (800M words) (Zhu et al.,
gleCloudTPU,orafewhoursonaGPU,starting
2015) and English Wikipedia (2,500M words).
from the exact same pre-trained model.7 We de-
For Wikipedia we extract only the text passages
scribe the task-specific details in the correspond-
and ignore lists, tables, and headers. It is criti-
ing subsections of Section 4. More details can be
cal to use a document-level corpus rather than a
foundinAppendixA.5.
shuffled sentence-level corpus such as the Billion
WordBenchmark(Chelbaetal.,2013)inorderto 4 Experiments
extractlongcontiguoussequences.
In this section, we present BERT fine-tuning re-
3.2 Fine-tuningBERT sultson11NLPtasks.
Fine-tuning is straightforward since the self- 4.1 GLUE
attention mechanism in the Transformer al-
The General Language Understanding Evaluation
lows BERT to model many downstream tasks—
(GLUE) benchmark (Wang et al., 2018a) is a col-
whether they involve single text or text pairs—by
lection of diverse natural language understanding
swapping out the appropriate inputs and outputs.
tasks. DetaileddescriptionsofGLUEdatasetsare
For applications involving text pairs, a common
includedinAppendixB.1.
pattern is to independently encode text pairs be-
To fine-tune on GLUE, we represent the input
fore applying bidirectional cross attention, such
sequence (for single sentence or sentence pairs)
as Parikh et al. (2016); Seo et al. (2017). BERT
as described in Section 3, and use the final hid-
insteadusestheself-attentionmechanismtounify
den vector C ∈ RH corresponding to the first
these two stages, as encoding a concatenated text
input token ([CLS]) as the aggregate representa-
pair with self-attention effectively includes bidi-
tion. The only new parameters introduced during
rectionalcrossattentionbetweentwosentences.
fine-tuning are classification layer weights W ∈
For each task, we simply plug in the task- RK×H,whereKisthenumberoflabels. Wecom-
specific inputs and outputs into BERT and fine-
pute a standard classification loss with C and W,
tune all the parameters end-to-end. At the in-
i.e.,log(softmax(CWT)).
put, sentence A and sentence B from pre-training
are analogous to (1) sentence pairs in paraphras-
7Forexample,theBERTSQuADmodelcanbetrainedin
around30minutesonasingleCloudTPUtoachieveaDev
ing,(2)hypothesis-premisepairsinentailment,(3)
F1scoreof91.0%.
question-passagepairsinquestionanswering,and 8See(10)inhttps://gluebenchmark.com/faq.

System MNLI-(m/mm) QQP QNLI SST-2 CoLA STS-B MRPC RTE Average
392k 363k 108k 67k 8.5k 5.7k 3.5k 2.5k -
Pre-OpenAISOTA 80.6/80.1 66.1 82.3 93.2 35.0 81.0 86.0 61.7 74.0
BiLSTM+ELMo+Attn 76.4/76.1 64.8 79.8 90.4 36.0 73.3 84.9 56.8 71.0
OpenAIGPT 82.1/81.4 70.3 87.4 91.3 45.4 80.0 82.3 56.0 75.1
BERT 84.6/83.4 71.2 90.5 93.5 52.1 85.8 88.9 66.4 79.6
BASE
BERT 86.7/85.9 72.1 92.7 94.9 60.5 86.5 89.3 70.1 82.1
LARGE
Table1: GLUETestresults, scoredbytheevaluationserver(https://gluebenchmark.com/leaderboard).
Thenumberbeloweachtaskdenotesthenumberoftrainingexamples. The“Average”columnisslightlydifferent
thantheofficialGLUEscore,sinceweexcludetheproblematicWNLIset.8 BERTandOpenAIGPTaresingle-
model,singletask. F1scoresarereportedforQQPandMRPC,SpearmancorrelationsarereportedforSTS-B,and
accuracyscoresarereportedfortheothertasks. WeexcludeentriesthatuseBERTasoneoftheircomponents.
We use a batch size of 32 and fine-tune for 3 Wikipedia containing the answer, the task is to
epochsoverthedataforallGLUEtasks. Foreach predicttheanswertextspaninthepassage.
task,weselectedthebestfine-tuninglearningrate As shown in Figure 1, in the question answer-
(among5e-5,4e-5,3e-5,and2e-5)ontheDevset. ing task, we represent the input question and pas-
Additionally,forBERT LARGE wefoundthatfine- sage as a single packed sequence, with the ques-
tuning was sometimes unstable on small datasets, tionusingtheAembeddingandthepassageusing
soweranseveralrandomrestartsandselectedthe the B embedding. We only introduce a start vec-
best model on the Dev set. With random restarts, tor S ∈ RH and an end vector E ∈ RH during
we use the same pre-trained checkpoint but per- fine-tuning. The probability of word i being the
form different fine-tuning data shuffling and clas- startoftheanswerspaniscomputedasadotprod-
sifierlayerinitialization.9 uct between T and S followed by a softmax over
i
Results are presented in Table 1. Both all of the words in the paragraph: P = eS·Ti .
i (cid:80) eS·Tj
BERT and BERT outperform all sys- j
BASE LARGE The analogous formula is used for the end of the
temsonalltasksbyasubstantialmargin,obtaining
answer span. The score of a candidate span from
4.5% and 7.0% respective average accuracy im-
positionitopositionj isdefinedasS·T +E·T ,
i j
provementoverthepriorstateoftheart. Notethat
and the maximum scoring span where j ≥ i is
BERT and OpenAI GPT are nearly identical
BASE used as a prediction. The training objective is the
in terms of model architecture apart from the at-
sum of the log-likelihoods of the correct start and
tention masking. For the largest and most widely
end positions. We fine-tune for 3 epochs with a
reportedGLUEtask,MNLI,BERTobtainsa4.6%
learningrateof5e-5andabatchsizeof32.
absolute accuracy improvement. On the official
Table 2 shows top leaderboard entries as well
GLUEleaderboard10,BERT obtainsascore
LARGE
as results from top published systems (Seo et al.,
of80.5,comparedtoOpenAIGPT,whichobtains
2017; Clark and Gardner, 2018; Peters et al.,
72.8asofthedateofwriting.
2018a; Hu et al., 2018). The top results from the
We find that BERT significantly outper-
LARGE SQuADleaderboarddonothaveup-to-datepublic
formsBERT acrossalltasks,especiallythose
BASE systemdescriptionsavailable,11andareallowedto
with very little training data. The effect of model
use any public data when training their systems.
sizeisexploredmorethoroughlyinSection5.2.
We therefore use modest data augmentation in
oursystembyfirstfine-tuningonTriviaQA(Joshi
4.2 SQuADv1.1
etal.,2017)beforfine-tuningonSQuAD.
The Stanford Question Answering Dataset
Ourbestperformingsystemoutperformsthetop
(SQuAD v1.1) is a collection of 100k crowd-
leaderboardsystemby+1.5F1inensemblingand
sourced question/answer pairs (Rajpurkar et al.,
+1.3 F1 as a single system. In fact, our single
2016). Given a question and a passage from
BERT model outperforms the top ensemble sys-
9TheGLUEdatasetdistributiondoesnotincludetheTest tem in terms of F1 score. Without TriviaQA fine-
labels, and we only made a single GLUE evaluation server
submissionforeachofBERT BASE andBERT LARGE . 11QANet is described in Yu et al. (2018), but the system
10https://gluebenchmark.com/leaderboard hasimprovedsubstantiallyafterpublication.

System Dev Test System Dev Test
EM F1 EM F1
ESIM+GloVe 51.9 52.7
TopLeaderboardSystems(Dec10th,2018) ESIM+ELMo 59.1 59.2
Human - - 82.3 91.2 OpenAIGPT - 78.0
#1Ensemble-nlnet - - 86.0 91.7
BERT 81.6 -
#2Ensemble-QANet - - 84.5 90.5 BASE
BERT 86.6 86.3
LARGE
Published
Human(expert)† - 85.0
BiDAF+ELMo(Single) - 85.6 - 85.8
R.M.Reader(Ensemble) 81.2 87.9 82.3 88.5 Human(5annotations)† - 88.0
Ours
Table4: SWAGDevandTestaccuracies. †Humanper-
BERT (Single) 80.8 88.5 - -
BASE
BERT (Single) 84.1 90.9 - - formanceismeasuredwith100samples,asreportedin
LARGE
BERT (Ensemble) 85.8 91.8 - - theSWAGpaper.
LARGE
BERT (Sgl.+TriviaQA) 84.2 91.1 85.1 91.8
LARGE
BERT (Ens.+TriviaQA) 86.2 92.2 87.4 93.2
LARGE
sˆ = max S·T +E·T . We predict a non-null
i,j j≥i i j
Table 2: SQuAD 1.1 results. The BERT ensemble
answer when sˆ > s +τ, where the thresh-
i,j null
is 7x systems which use different pre-training check-
old τ is selected on the dev set to maximize F1.
pointsandfine-tuningseeds.
We did not use TriviaQA data for this model. We
fine-tunedfor2epochswithalearningrateof5e-5
System Dev Test
andabatchsizeof48.
EM F1 EM F1
The results compared to prior leaderboard en-
TopLeaderboardSystems(Dec10th,2018)
Human 86.3 89.0 86.9 89.5 tries and top published work (Sun et al., 2018;
#1Single-MIR-MRC(F-Net) - - 74.8 78.0 Wangetal.,2018b)areshowninTable3,exclud-
#2Single-nlnet - - 74.2 77.1
ing systems that use BERT as one of their com-
Published
ponents. Weobservea+5.1F1improvementover
unet(Ensemble) - - 71.4 74.9
SLQA+(Single) - 71.4 74.4 thepreviousbestsystem.
Ours
4.4 SWAG
BERT (Single) 78.7 81.9 80.0 83.1
LARGE
The Situations With Adversarial Generations
Table 3: SQuAD 2.0 results. We exclude entries that (SWAG)datasetcontains113ksentence-paircom-
useBERTasoneoftheircomponents. pletionexamplesthatevaluategroundedcommon-
senseinference(Zellersetal.,2018). Givenasen-
tence,thetaskistochoosethemostplausiblecon-
tuning data, we only lose 0.1-0.4 F1, still outper-
tinuationamongfourchoices.
formingallexistingsystemsbyawidemargin.12
When fine-tuning on the SWAG dataset, we
4.3 SQuADv2.0 construct four input sequences, each containing
the concatenation of the given sentence (sentence
The SQuAD 2.0 task extends the SQuAD 1.1
A) and a possible continuation (sentence B). The
problem definition by allowing for the possibility
only task-specific parameters introduced is a vec-
that no short answer exists in the provided para-
torwhosedotproductwiththe[CLS]tokenrep-
graph,makingtheproblemmorerealistic.
resentation C denotes a score for each choice
WeuseasimpleapproachtoextendtheSQuAD
whichisnormalizedwithasoftmaxlayer.
v1.1 BERT model for this task. We treat ques-
We fine-tune the model for 3 epochs with a
tions that do not have an answer as having an an-
learning rate of 2e-5 and a batch size of 16. Re-
swer span with start and end at the [CLS] to-
sults are presented in Table 4. BERT out-
ken. The probability space for the start and end LARGE
performs the authors’ baseline ESIM+ELMo sys-
answer span positions is extended to include the
temby+27.1%andOpenAIGPTby8.3%.
position of the [CLS] token. For prediction, we
comparethescoreoftheno-answerspan: s =
null 5 AblationStudies
S·C +E·C tothescoreofthebestnon-nullspan
In this section, we perform ablation experiments
12TheTriviaQAdataweusedconsistsofparagraphsfrom
overanumberoffacetsofBERTinordertobetter
TriviaQA-Wikiformedofthefirst400tokensindocuments,
thatcontainatleastoneoftheprovidedpossibleanswers. understand their relative importance. Additional

|       |        |       |       | DevSet |             | results | are still far | worse   | than | those | of     | the pre- |
| ----- | ------ | ----- | ----- | ------ | ----------- | ------- | ------------- | ------- | ---- | ----- | ------ | -------- |
| Tasks | MNLI-m |       | QNLI  | MRPC   | SST-2 SQuAD |         |               |         |      |       |        |          |
|       |        |       |       |        |             | trained | bidirectional | models. |      | The   | BiLSTM | hurts    |
|       |        | (Acc) | (Acc) | (Acc)  | (Acc) (F1)  |         |               |         |      |       |        |          |
performanceontheGLUEtasks.
| BERT  |     | 84.4 | 88.4 | 86.7 | 92.7 88.5 |              |     |         |       |      |             |     |
| ----- | --- | ---- | ---- | ---- | --------- | ------------ | --- | ------- | ----- | ---- | ----------- | --- |
| BASE  |     |      |      |      |           | We recognize |     | that it | would | also | be possible | to  |
| NoNSP |     | 83.9 | 84.9 | 86.5 | 92.6 87.9 |              |     |         |       |      |             |     |
LTR&NoNSP 82.1 84.3 77.5 92.1 77.8 trainseparateLTRandRTLmodelsandrepresent
| +BiLSTM |     | 82.1 | 84.1 | 75.7 | 91.6 84.9 |              |        |               |     |     |         |          |
| ------- | --- | ---- | ---- | ---- | --------- | ------------ | ------ | ------------- | --- | --- | ------- | -------- |
|         |     |      |      |      |           | each token   | as the | concatenation |     | of  | the     | two mod- |
|         |     |      |      |      |           | els, as ELMo | does.  | However:      |     | (a) | this is | twice as |
Table5: Ablationoverthepre-trainingtasksusingthe
|      |               |     |          |            |         | expensive | as a single | bidirectional |     |     | model; | (b) this |
| ---- | ------------- | --- | -------- | ---------- | ------- | --------- | ----------- | ------------- | --- | --- | ------ | -------- |
| BERT | architecture. |     | “No NSP” | is trained | without |           |             |               |     |     |        |          |
BASE
|                                |     |     |     |               |     | is non-intuitive | for | tasks | like | QA, | since | the RTL |
| ------------------------------ | --- | --- | --- | ------------- | --- | ---------------- | --- | ----- | ---- | --- | ----- | ------- |
| thenextsentencepredictiontask. |     |     |     | “LTR&NoNSP”is |     |                  |     |       |      |     |       |         |
trainedasaleft-to-rightLMwithoutthenextsentence model would not be able to condition the answer
|     |     |     |     |     |     | onthequestion; |     | (c)thisitisstrictlylesspowerful |     |     |     |     |
| --- | --- | --- | --- | --- | --- | -------------- | --- | ------------------------------- | --- | --- | --- | --- |
prediction,likeOpenAIGPT.“+BiLSTM”addsaran-
domly initialized BiLSTM on top of the “LTR + No than a deep bidirectional model, since it can use
NSP”modelduringfine-tuning.
bothleftandrightcontextateverylayer.
5.2 EffectofModelSize
ablationstudiescanbefoundinAppendixC.
Inthissection,weexploretheeffectofmodelsize
5.1 EffectofPre-trainingTasks onfine-tuningtaskaccuracy. Wetrainedanumber
ofBERTmodelswithadifferingnumberoflayers,
| We demonstrate |     | the importance |     | of the | deep bidi- |     |     |     |     |     |     |     |
| -------------- | --- | -------------- | --- | ------ | ---------- | --- | --- | --- | --- | --- | --- | --- |
hiddenunits,andattentionheads,whileotherwise
| rectionality | of         | BERT  | by      | evaluating | two pre-  |           |                      |     |     |     |          |      |
| ------------ | ---------- | ----- | ------- | ---------- | --------- | --------- | -------------------- | --- | --- | --- | -------- | ---- |
|              |            |       |         |            |           | using the | same hyperparameters |     |     | and | training | pro- |
| training     | objectives | using | exactly | the        | same pre- |           |                      |     |     |     |          |      |
cedureasdescribedpreviously.
| training       | data, fine-tuning |     | scheme, |     | and hyperpa- |         |             |     |      |       |     |          |
| -------------- | ----------------- | --- | ------- | --- | ------------ | ------- | ----------- | --- | ---- | ----- | --- | -------- |
|                |                   |     |         |     |              | Results | on selected |     | GLUE | tasks | are | shown in |
| rametersasBERT |                   |     | :       |     |              |         |             |     |      |       |     |          |
BASE
|     |     |     |     |     |     | Table 6. | In this | table, | we report | the | average | Dev |
| --- | --- | --- | --- | --- | --- | -------- | ------- | ------ | --------- | --- | ------- | --- |
No NSP: A bidirectional model which is trained Setaccuracyfrom5randomrestartsoffine-tuning.
using the “masked LM” (MLM) but without the We can see that larger models lead to a strict ac-
“nextsentenceprediction”(NSP)task. curacyimprovementacrossallfourdatasets, even
LTR&NoNSP:Aleft-context-onlymodelwhich
|     |     |     |     |     |     | for MRPC | which | only | has | 3,600 | labeled | train- |
| --- | --- | --- | --- | --- | --- | -------- | ----- | ---- | --- | ----- | ------- | ------ |
is trained using a standard Left-to-Right (LTR) ing examples, and is substantially different from
LM,ratherthananMLM.Theleft-onlyconstraint the pre-training tasks. It is also perhaps surpris-
wasalsoappliedatfine-tuning,becauseremoving
|     |     |     |     |     |     | ing that | we are | able to | achieve | such | significant |     |
| --- | --- | --- | --- | --- | --- | -------- | ------ | ------- | ------- | ---- | ----------- | --- |
it introduced a pre-train/fine-tune mismatch that improvements on top of models which are al-
degraded downstream performance. Additionally, readyquitelargerelativetotheexistingliterature.
this model was pre-trained without the NSP task. For example, the largest Transformer explored in
| This is directly |     | comparable |     | to OpenAI | GPT, but |         |               |     |          |         |     |       |
| ---------------- | --- | ---------- | --- | --------- | -------- | ------- | ------------- | --- | -------- | ------- | --- | ----- |
|                  |     |            |     |           |          | Vaswani | et al. (2017) |     | is (L=6, | H=1024, |     | A=16) |
using our larger training dataset, our input repre- with 100M parameters for the encoder, and the
sentation,andourfine-tuningscheme. largestTransformerwehavefoundintheliterature
WefirstexaminetheimpactbroughtbytheNSP is (L=64, H=512, A=2) with 235M parameters
task. In Table 5, we show that removing NSP (Al-Rfou et al., 2018). By contrast, BERT
BASE
hurts performance significantly on QNLI, MNLI, contains 110M parameters and BERT con-
LARGE
and SQuAD 1.1. Next, we evaluate the impact tains340Mparameters.
of training bidirectional representations by com- It has long been known that increasing the
paring “No NSP” to “LTR & No NSP”. The LTR model size will lead to continual improvements
modelperformsworsethantheMLMmodelonall on large-scale tasks such as machine translation
tasks,withlargedropsonMRPCandSQuAD. and language modeling, which is demonstrated
For SQuAD it is intuitively clear that a LTR by the LM perplexity of held-out training data
model will perform poorly at token predictions, shown in Table 6. However, we believe that
since the token-level hidden states have no right- this is the first work to demonstrate convinc-
side context. In order to make a good faith at- ingly that scaling to extreme model sizes also
tempt at strengthening the LTR system, we added leads to large improvements on very small scale
arandomlyinitializedBiLSTMontop. Thisdoes tasks, provided that the model has been suffi-
significantly improve results on SQuAD, but the cientlypre-trained. Petersetal.(2018b)presented

mixed results on the downstream task impact of System DevF1 TestF1
increasing the pre-trained bi-LM size from two ELMo(Petersetal.,2018a) 95.7 92.2
to four layers and Melamud et al. (2016) men- CVT(Clarketal.,2018) - 92.6
|           |         |      |            |     |        |        | CSE(Akbiketal.,2018) |     |     |     | -   | 93.1 |
| --------- | ------- | ---- | ---------- | --- | ------ | ------ | -------------------- | --- | --- | --- | --- | ---- |
| tioned in | passing | that | increasing |     | hidden | dimen- |                      |     |     |     |     |      |
Fine-tuningapproach
| sion size | from | 200 to | 600 helped, |     | but increasing |     |      |     |     |     |      |      |
| --------- | ---- | ------ | ----------- | --- | -------------- | --- | ---- | --- | --- | --- | ---- | ---- |
|           |      |        |             |     |                |     | BERT |     |     |     | 96.6 | 92.8 |
LARGE
further to 1,000 did not bring further improve- BERT 96.4 92.4
BASE
| ments.         | Both of | these | prior       | works | used a | feature- |                            |     |     |      |      |     |
| -------------- | ------- | ----- | ----------- | ----- | ------ | -------- | -------------------------- | --- | --- | ---- | ---- | --- |
|                |         |       |             |       |        |          | Feature-basedapproach(BERT |     |     | BASE | )    |     |
| based approach |         | — we  | hypothesize |       | that   | when the |                            |     |     |      |      |     |
|                |         |       |             |       |        |          | Embeddings                 |     |     |      | 91.0 | -   |
model is fine-tuned directly on the downstream Second-to-LastHidden 95.6 -
tasks and uses only a very small number of ran- LastHidden 94.9 -
|                   |     |            |     |             |     |           | WeightedSumLastFourHidden |     |     |     | 95.9 | -   |
| ----------------- | --- | ---------- | --- | ----------- | --- | --------- | ------------------------- | --- | --- | --- | ---- | --- |
| domly initialized |     | additional |     | parameters, |     | the task- |                           |     |     |     |      |     |
|                   |     |            |     |             |     |           | ConcatLastFourHidden      |     |     |     | 96.1 | -   |
specific models can benefit from the larger, more WeightedSumAll12Layers 95.5 -
| expressive | pre-trained |     | representations |     | even | when |          |            |       |     |                    |     |
| ---------- | ----------- | --- | --------------- | --- | ---- | ---- | -------- | ---------- | ----- | --- | ------------------ | --- |
|            |             |     |                 |     |      |      | Table 7: | CoNLL-2003 | Named |     | Entity Recognition | re- |
downstreamtaskdataisverysmall.
|     |     |     |     |     |     |     | sults. Hyperparameters |     |     | were selected | using | the Dev |
| --- | --- | --- | --- | --- | --- | --- | ---------------------- | --- | --- | ------------- | ----- | ------- |
set.ThereportedDevandTestscoresareaveragedover
5.3 Feature-basedApproachwithBERT
5randomrestartsusingthosehyperparameters.
AlloftheBERTresultspresentedsofarhaveused
| the fine-tuning |     | approach, | where | a   | simple | classifi- |     |     |     |     |     |     |
| --------------- | --- | --------- | ----- | --- | ------ | --------- | --- | --- | --- | --- | --- | --- |
cationlayerisaddedtothepre-trainedmodel,and
|     |     |     |     |     |     |     | layer in | the output. | We  | use | the representation | of  |
| --- | --- | --- | --- | --- | --- | --- | -------- | ----------- | --- | --- | ------------------ | --- |
all parameters are jointly fine-tuned on a down- the first sub-token as the input to the token-level
streamtask. However,thefeature-basedapproach, classifierovertheNERlabelset.
| where fixed | features |     | are extracted |     | from | the pre- |     |     |     |     |     |     |
| ----------- | -------- | --- | ------------- | --- | ---- | -------- | --- | --- | --- | --- | --- | --- |
Toablatethefine-tuningapproach,weapplythe
| trained   | model, | has certain | advantages. |     |     | First, not |               |          |      |               |         |             |
| --------- | ------ | ----------- | ----------- | --- | --- | ---------- | ------------- | -------- | ---- | ------------- | ------- | ----------- |
|           |        |             |             |     |     |            | feature-based | approach |      | by extracting |         | the activa- |
| all tasks | can    | be easily   | represented |     | by  | a Trans-   |               |          |      |               |         |             |
|           |        |             |             |     |     |            | tions from    | one or   | more | layers        | without | fine-tuning |
formerencoderarchitecture,andthereforerequire
|                 |       |           |               |     |       |          | any parameters | of              | BERT.    | These | contextual | em-      |
| --------------- | ----- | --------- | ------------- | --- | ----- | -------- | -------------- | --------------- | -------- | ----- | ---------- | -------- |
| a task-specific |       | model     | architecture  |     | to be | added.   |                |                 |          |       |            |          |
|                 |       |           |               |     |       |          | beddings       | are used        | as input | to    | a randomly | initial- |
| Second,         | there | are major | computational |     |       | benefits |                |                 |          |       |            |          |
|                 |       |           |               |     |       |          | ized two-layer | 768-dimensional |          |       | BiLSTM     | before   |
topre-computeanexpensiverepresentationofthe
theclassificationlayer.
trainingdataonceandthenrunmanyexperiments
|                                             |     |     |     |     |     |     | Results | are presented |     | in Table | 7. BERT |       |
| ------------------------------------------- | --- | --- | --- | --- | --- | --- | ------- | ------------- | --- | -------- | ------- | ----- |
| withcheapermodelsontopofthisrepresentation. |     |     |     |     |     |     |         |               |     |          |         | LARGE |
performscompetitivelywithstate-of-the-artmeth-
Inthissection,wecomparethetwoapproaches
|             |      |     |     |            |     |       | ods. Thebestperformingmethodconcatenatesthe |     |     |     |     |     |
| ----------- | ---- | --- | --- | ---------- | --- | ----- | ------------------------------------------- | --- | --- | --- | --- | --- |
| by applying | BERT | to  | the | CoNLL-2003 |     | Named |                                             |     |     |     |     |     |
tokenrepresentationsfromthetopfourhiddenlay-
| Entity Recognition    |     | (NER) | task                | (Tjong | Kim    | Sang   |            |                    |              |     |               |         |
| --------------------- | --- | ----- | ------------------- | ------ | ------ | ------ | ---------- | ------------------ | ------------ | --- | ------------- | ------- |
|                       |     |       |                     |        |        |        | ers of the | pre-trained        | Transformer, |     | which         | is only |
| andDeMeulder,2003).   |     |       | IntheinputtoBERT,we |        |        |        |            |                    |              |     |               |         |
|                       |     |       |                     |        |        |        | 0.3 F1     | behind fine-tuning |              | the | entire model. | This    |
| use a case-preserving |     |       | WordPiece           |        | model, | and we |            |                    |              |     |               |         |
demonstratesthatBERTiseffectiveforbothfine-
| include | the maximal |     | document | context |     | provided |     |     |     |     |     |     |
| ------- | ----------- | --- | -------- | ------- | --- | -------- | --- | --- | --- | --- | --- | --- |
tuningandfeature-basedapproaches.
| by the data. | Following |     | standard | practice, |     | we for- |     |     |     |     |     |     |
| ------------ | --------- | --- | -------- | --------- | --- | ------- | --- | --- | --- | --- | --- | --- |
mulatethisasataggingtaskbutdonotuseaCRF
|             |     |     |     |                |     |     | 6 Conclusion |     |     |     |     |     |
| ----------- | --- | --- | --- | -------------- | --- | --- | ------------ | --- | --- | --- | --- | --- |
| Hyperparams |     |     |     | DevSetAccuracy |     |     |              |     |     |     |     |     |
#L #H #A LM(ppl) MNLI-m MRPC SST-2 Recent empirical improvements due to transfer
learningwithlanguagemodelshavedemonstrated
| 3   | 768 12 | 5.84   | 77.9 |     | 79.8 | 88.4 |            |              |     |              |     |             |
| --- | ------ | ------ | ---- | --- | ---- | ---- | ---------- | ------------ | --- | ------------ | --- | ----------- |
|     |        |        |      |     |      |      | that rich, | unsupervised |     | pre-training | is  | an integral |
| 6   | 768    | 3 5.24 | 80.6 |     | 82.2 | 90.7 |            |              |     |              |     |             |
6 768 12 4.68 81.9 84.8 91.3 part of many language understanding systems. In
| 12  | 768 12 | 3.99 | 84.4 |     | 86.7 | 92.9 |     |     |     |     |     |     |
| --- | ------ | ---- | ---- | --- | ---- | ---- | --- | --- | --- | --- | --- | --- |
12 1024 16 3.54 85.7 86.9 93.3 particular, these results enable even low-resource
24 1024 16 3.23 86.6 87.8 93.7 taskstobenefitfromdeepunidirectionalarchitec-
|     |     |     |     |     |     |     | tures. Our | major | contribution |     | is further | general- |
| --- | --- | --- | --- | --- | --- | --- | ---------- | ----- | ------------ | --- | ---------- | -------- |
Table 6: Ablation over BERT model size. #L = the izingthesefindingstodeepbidirectionalarchitec-
tures,allowingthesamepre-trainedmodeltosuc-
numberoflayers;#H=hiddensize;#A=numberofat-
tentionheads.“LM(ppl)”isthemaskedLMperplexity cessfullytackleabroadsetofNLPtasks.
ofheld-outtrainingdata.

| References  |            |         |            |            |              | KevinClark,Minh-ThangLuong,ChristopherDMan- |      |                 |                 |           |         |
| ----------- | ---------- | ------- | ---------- | ---------- | ------------ | ------------------------------------------- | ---- | --------------- | --------------- | --------- | ------- |
|             |            |         |            |            |              | ning, and                                   | Quoc | Le. 2018.       | Semi-supervised |           | se-     |
| Alan Akbik, | Duncan     | Blythe, |            | and Roland | Vollgraf.    |                                             |      |                 |                 |           |         |
|             |            |         |            |            |              | quence modeling                             |      | with cross-view |                 | training. | In Pro- |
| 2018.       | Contextual | string  | embeddings |            | for sequence |                                             |      |                 |                 |           |         |
ceedingsofthe2018ConferenceonEmpiricalMeth-
labeling. In Proceedings of the 27th International ods in Natural Language Processing, pages 1914–
| Conference |     | on Computational |     | Linguistics, | pages | 1925. |     |     |     |     |     |
| ---------- | --- | ---------------- | --- | ------------ | ----- | ----- | --- | --- | --- | --- | --- |
1638–1649.
|     |     |     |     |     |     | Ronan Collobert | and | Jason Weston. |     | 2008. | A unified |
| --- | --- | --- | --- | --- | --- | --------------- | --- | ------------- | --- | ----- | --------- |
RamiAl-Rfou, DokookChoe, NoahConstant, Mandy architecture for natural language processing: Deep
Guo, and Llion Jones. 2018. Character-level lan- neural networks with multitask learning. In Pro-
guage modeling with deeper self-attention. arXiv ceedings of the 25th international conference on
| preprintarXiv:1808.04444. |     |     |     |     |     | Machinelearning,pages160–167.ACM. |     |     |     |     |     |
| ------------------------- | --- | --- | --- | --- | --- | --------------------------------- | --- | --- | --- | --- | --- |
RieKubotaAndoandTongZhang.2005. Aframework AlexisConneau,DouweKiela,HolgerSchwenk,Lo¨ıc
forlearningpredictivestructuresfrommultipletasks Barrault, and Antoine Bordes. 2017. Supervised
|               |     |               |     |            |          | learning         | of universal | sentence  | representations |                | from |
| ------------- | --- | ------------- | --- | ---------- | -------- | ---------------- | ------------ | --------- | --------------- | -------------- | ---- |
| and unlabeled |     | data. Journal |     | of Machine | Learning |                  |              |           |                 |                |      |
|               |     |               |     |            |          | natural language |              | inference | data.           | In Proceedings | of   |
Research,6(Nov):1817–1853.
the2017ConferenceonEmpiricalMethodsinNat-
|                   |             |          |          |              |            | ural Language   | Processing, |             | pages | 670–680,      | Copen- |
| ----------------- | ----------- | -------- | -------- | ------------ | ---------- | --------------- | ----------- | ----------- | ----- | ------------- | ------ |
| Luisa Bentivogli, |             | Bernardo | Magnini, |              | Ido Dagan, |                 |             |             |       |               |        |
|                   |             |          |          |              |            | hagen, Denmark. |             | Association | for   | Computational |        |
| Hoa               | Trang Dang, | and      | Danilo   | Giampiccolo. | 2009.      |                 |             |             |       |               |        |
Linguistics.
| The fifth     | PASCAL      | recognizing |     | textual  | entailment |                            |           |          |     |                 |          |
| ------------- | ----------- | ----------- | --- | -------- | ---------- | -------------------------- | --------- | -------- | --- | --------------- | -------- |
| challenge.    | InTAC.NIST. |             |     |          |            |                            |           |          |     |                 |          |
|               |             |             |     |          |            | AndrewMDaiandQuocVLe.2015. |           |          |     | Semi-supervised |          |
|               |             |             |     |          |            |                            |           | Advances |     | in neural       | informa- |
|               |             |             |     |          |            | sequence                   | learning. | In       |     |                 |          |
| John Blitzer, | Ryan        | McDonald,   | and | Fernando | Pereira.   |                            |           |          |     |                 |          |
tionprocessingsystems,pages3079–3087.
2006. Domainadaptationwithstructuralcorrespon-
| dencelearning. |     | InProceedingsofthe2006confer- |     |     |     |     |     |     |     |     |     |
| -------------- | --- | ----------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
J.Deng,W.Dong,R.Socher,L.-J.Li,K.Li,andL.Fei-
enceonempiricalmethodsinnaturallanguagepro- Fei. 2009. ImageNet: A Large-Scale Hierarchical
cessing, pages 120–128. Association for Computa- ImageDatabase. InCVPR09.
tionalLinguistics.
|     |     |     |     |     |     | WilliamBDolanandChrisBrockett.2005. |     |     |     |     | Automati- |
| --- | --- | --- | --- | --- | --- | ----------------------------------- | --- | --- | --- | --- | --------- |
SamuelR.Bowman,GaborAngeli,ChristopherPotts, callyconstructingacorpusofsententialparaphrases.
and Christopher D. Manning. 2015. A large anno- InProceedingsoftheThirdInternationalWorkshop
tatedcorpusforlearningnaturallanguageinference. onParaphrasing(IWP2005).
InEMNLP.AssociationforComputationalLinguis-
| tics. |     |     |     |     |     | William Fedus, | Ian | Goodfellow,                      | and | Andrew | M Dai. |
| ----- | --- | --- | --- | --- | --- | -------------- | --- | -------------------------------- | --- | ------ | ------ |
|       |     |     |     |     |     | 2018. Maskgan: |     | Bettertextgenerationviafillingin |     |        |        |
Peter F Brown, Peter V Desouza, Robert L Mercer, the . arXivpreprintarXiv:1801.07736.
| Vincent | J Della | Pietra, | and | Jenifer | C Lai. 1992. |     |     |     |     |     |     |
| ------- | ------- | ------- | --- | ------- | ------------ | --- | --- | --- | --- | --- | --- |
Class-based n-gram models of natural language. Dan Hendrycks and Kevin Gimpel. 2016. Bridging
Computationallinguistics,18(4):467–479. nonlinearitiesandstochasticregularizerswithgaus-
|             |      |       |       |         |              | sianerrorlinearunits. |     | CoRR,abs/1606.08415. |     |     |     |
| ----------- | ---- | ----- | ----- | ------- | ------------ | --------------------- | --- | -------------------- | --- | --- | --- |
| Daniel Cer, | Mona | Diab, | Eneko | Agirre, | Inigo Lopez- |                       |     |                      |     |     |     |
FelixHill,KyunghyunCho,andAnnaKorhonen.2016.
| Gazpio, | and                                      | Lucia Specia. | 2017. | Semeval-2017 |     |          |             |                 |     |     |           |
| ------- | ---------------------------------------- | ------------- | ----- | ------------ | --- | -------- | ----------- | --------------- | --- | --- | --------- |
|         |                                          |               |       |              |     | Learning | distributed | representations |     | of  | sentences |
| task1:  | Semantictextualsimilaritymultilingualand |               |       |              |     |          |             |                 |     |     |           |
crosslingual focused evaluation. In Proceedings from unlabelled data. In Proceedings of the 2016
|            |                 |               |          |               |             | Conference                              | of the        | North       | American | Chapter | of the   |
| ---------- | --------------- | ------------- | -------- | ------------- | ----------- | --------------------------------------- | ------------- | ----------- | -------- | ------- | -------- |
| of the     | 11th            | International | Workshop |               | on Semantic |                                         |               |             |          |         |          |
|            |                 |               |          |               |             | AssociationforComputationalLinguistics: |               |             |          |         | Human    |
| Evaluation | (SemEval-2017), |               |          | pages 1–14,   | Vancou-     |                                         |               |             |          |         |          |
|            |                 |               |          |               |             | Language                                | Technologies. | Association |          | for     | Computa- |
| ver,       | Canada.         | Association   | for      | Computational | Lin-        |                                         |               |             |          |         |          |
tionalLinguistics.
guistics.
|     |     |     |     |     |     | JeremyHowardandSebastianRuder.2018. |     |     |     |     | Universal |
| --- | --- | --- | --- | --- | --- | ----------------------------------- | --- | --- | --- | --- | --------- |
CiprianChelba,TomasMikolov,MikeSchuster,QiGe,
|          |         |          |        |     |             | languagemodelfine-tuningfortextclassification. |     |     |     |     | In  |
| -------- | ------- | -------- | ------ | --- | ----------- | ---------------------------------------------- | --- | --- | --- | --- | --- |
| Thorsten | Brants, | Phillipp | Koehn, | and | Tony Robin- |                                                |     |     |     |     |     |
ACL.AssociationforComputationalLinguistics.
| son.2013.                                 | Onebillionwordbenchmarkformeasur- |     |     |     |       |     |     |     |     |     |     |
| ----------------------------------------- | --------------------------------- | --- | --- | --- | ----- | --- | --- | --- | --- | --- | --- |
| ingprogressinstatisticallanguagemodeling. |                                   |     |     |     | arXiv |     |     |     |     |     |     |
MinghaoHu,YuxingPeng,ZhenHuang,XipengQiu,
preprintarXiv:1312.3005.
|          |           |     |        |        |             | Furu Wei,      | and    | Ming Zhou.  | 2018.   |     | Reinforced |
| -------- | --------- | --- | ------ | ------ | ----------- | -------------- | ------ | ----------- | ------- | --- | ---------- |
|          |           |     |        |        |             | mnemonic       | reader | for machine | reading |     | comprehen- |
| Z. Chen, | H. Zhang, | X.  | Zhang, | and L. | Zhao. 2018. | sion. InIJCAI. |        |             |         |     |            |
Quoraquestionpairs.
|     |     |     |     |     |     | Yacine Jernite, | Samuel | R. Bowman, |     | and | David Son- |
| --- | --- | --- | --- | --- | --- | --------------- | ------ | ---------- | --- | --- | ---------- |
Christopher Clark and Matt Gardner. 2018. Simple tag. 2017. Discourse-based objectives for fast un-
and effective multi-paragraph reading comprehen- supervisedsentencerepresentationlearning. CoRR,
| sion. | InACL. |     |     |     |     | abs/1705.00557. |     |     |     |     |     |
| ----- | ------ | --- | --- | --- | --- | --------------- | --- | --- | --- | --- | --- |

Mandar Joshi, Eunsol Choi, Daniel S Weld, and Luke Matthew Peters, Mark Neumann, Luke Zettlemoyer,
Zettlemoyer.2017. Triviaqa: Alargescaledistantly and Wen-tau Yih. 2018b. Dissecting contextual
supervisedchallengedatasetforreadingcomprehen- wordembeddings: Architectureandrepresentation.
sion. InACL. In Proceedings of the 2018 Conference on Empiri-
calMethodsinNaturalLanguageProcessing,pages
| Ryan Kiros, | Yukun  | Zhu,   | Ruslan   | R       | Salakhutdinov, |           | 1499–1509. |     |     |     |     |     |     |
| ----------- | ------ | ------ | -------- | ------- | -------------- | --------- | ---------- | --- | --- | --- | --- | --- | --- |
| Richard     | Zemel, | Raquel | Urtasun, | Antonio |                | Torralba, |            |     |     |     |     |     |     |
and Sanja Fidler. 2015. Skip-thought vectors. In AlecRadford,KarthikNarasimhan,TimSalimans,and
Advancesinneuralinformationprocessingsystems, Ilya Sutskever. 2018. Improving language under-
pages3294–3302. standing with unsupervised learning. Technical re-
port,OpenAI.
| Quoc Le      | and Tomas | Mikolov.  |     | 2014.      | Distributed | rep-      |     |     |     |     |     |     |     |
| ------------ | --------- | --------- | --- | ---------- | ----------- | --------- | --- | --- | --- | --- | --- | --- | --- |
| resentations | of        | sentences | and | documents. |             | In Inter- |     |     |     |     |     |     |     |
PranavRajpurkar,JianZhang,KonstantinLopyrev,and
national Conference on Machine Learning, pages Percy Liang. 2016. Squad: 100,000+ questions for
| 1188–1196. |     |     |     |     |     |     | machine | comprehension |     | of text. | In Proceedings |     | of  |
| ---------- | --- | --- | --- | --- | --- | --- | ------- | ------------- | --- | -------- | -------------- | --- | --- |
the2016ConferenceonEmpiricalMethodsinNat-
Hector J Levesque, Ernest Davis, and Leora Morgen- uralLanguageProcessing,pages2383–2392.
| stern. | 2011. | The winograd |     | schema | challenge. | In  |     |     |     |     |     |     |     |
| ------ | ----- | ------------ | --- | ------ | ---------- | --- | --- | --- | --- | --- | --- | --- | --- |
Aaai spring symposium: Logical formalizations of Minjoon Seo, Aniruddha Kembhavi, Ali Farhadi, and
commonsensereasoning,volume46,page47.
|           |                  |     |             |          |            |           | Hannaneh                     | Hajishirzi. |      | 2017. Bidirectional |         | attention |       |
| --------- | ---------------- | --- | ----------- | -------- | ---------- | --------- | ---------------------------- | ----------- | ---- | ------------------- | ------- | --------- | ----- |
|           |                  |     |             |          |            |           | flowformachinecomprehension. |             |      |                     | InICLR. |           |       |
| Lajanugen | Logeswaran       |     | and Honglak |          | Lee. 2018. | An        |                              |             |      |                     |         |           |       |
| efficient | framework        | for | learning    | sentence |            | represen- |                              |             |      |                     |         |           |       |
|           |                  |     |             |          |            |           | Richard Socher,              |             | Alex | Perelygin,          | Jean    | Wu,       | Jason |
| tations.  | In International |     | Conference  |          | on         | Learning  |                              |             |      |                     |         |           |       |
|           |                  |     |             |          |            |           | Chuang,                      | Christopher | D    | Manning,            | Andrew  | Ng,       | and   |
Representations.
|     |     |     |     |     |     |     | Christopher | Potts. | 2013. | Recursive |     | deep models |     |
| --- | --- | --- | --- | --- | --- | --- | ----------- | ------ | ----- | --------- | --- | ----------- | --- |
forsemanticcompositionalityoverasentimenttree-
BryanMcCann,JamesBradbury,CaimingXiong,and
|                         |     |     |                       |     |     |      | bank. In  | Proceedings |     | of the  | 2013 conference |             | on  |
| ----------------------- | --- | --- | --------------------- | --- | --- | ---- | --------- | ----------- | --- | ------- | --------------- | ----------- | --- |
| RichardSocher.2017.     |     |     | Learnedintranslation: |     |     | Con- |           |             |     |         |                 |             |     |
|                         |     |     |                       |     |     |      | empirical | methods     | in  | natural | language        | processing, |     |
| textualizedwordvectors. |     |     | InNIPS.               |     |     |      |           |             |     |         |                 |             |     |
pages1631–1642.
| Oren Melamud,                 |              | Jacob | Goldberger, |         | and Ido  | Dagan. |                   |        |            |         |               |          |      |
| ----------------------------- | ------------ | ----- | ----------- | ------- | -------- | ------ | ----------------- | ------ | ---------- | ------- | ------------- | -------- | ---- |
|                               |              |       |             |         |          |        | Fu Sun, Linyang   |        | Li, Xipeng |         | Qiu, and      | Yang     | Liu. |
| 2016.                         | context2vec: |       | Learning    | generic | context  | em-    |                   |        |            |         |               |          |      |
|                               |              |       |             |         |          |        | 2018.             | U-net: | Machine    | reading | comprehension |          |      |
| beddingwithbidirectionalLSTM. |              |       |             |         | InCoNLL. |        |                   |        |            |         |               |          |      |
|                               |              |       |             |         |          |        | with unanswerable |        | questions. |         | arXiv         | preprint |      |
arXiv:1810.06638.
TomasMikolov,IlyaSutskever,KaiChen,GregSCor-
| rado, and | Jeff | Dean. | 2013. | Distributed | representa- |     |          |         |       |       |            |     |     |
| --------- | ---- | ----- | ----- | ----------- | ----------- | --- | -------- | ------- | ----- | ----- | ---------- | --- | --- |
|           |      |       |       |             |             |     | Wilson L | Taylor. | 1953. | Cloze | procedure: | A   | new |
tionsofwordsandphrasesandtheircompositional-
ity. In Advances in Neural Information Processing toolformeasuringreadability. JournalismBulletin,
| Systems | 26,   |            |     |        |             |     | 30(4):415–433. |     |     |     |     |     |     |
| ------- | ----- | ---------- | --- | ------ | ----------- | --- | -------------- | --- | --- | --- | --- | --- | --- |
|         | pages | 3111–3119. |     | Curran | Associates, |     |                |     |     |     |     |     |     |
Inc.
|                   |     |             |     |          |        |         | Erik F Tjong                                | Kim | Sang | and            | Fien | De Meulder. |       |
| ----------------- | --- | ----------- | --- | -------- | ------ | ------- | ------------------------------------------- | --- | ---- | -------------- | ---- | ----------- | ----- |
|                   |     |             |     |          |        |         | 2003. Introduction                          |     | to   | the conll-2003 |      | shared      | task: |
| Andriy Mnih       | and | Geoffrey    | E   | Hinton.  | 2009.  | A scal- |                                             |     |      |                |      |             |       |
|                   |     |             |     |          |        |         | Language-independentnamedentityrecognition. |     |      |                |      |             | In    |
| able hierarchical |     | distributed |     | language | model. | In      |                                             |     |      |                |      |             |       |
CoNLL.
| D. Koller,    | D.  | Schuurmans, |           | Y. Bengio,  | and | L. Bot- |     |     |     |     |     |     |     |
| ------------- | --- | ----------- | --------- | ----------- | --- | ------- | --- | --- | --- | --- | --- | --- | --- |
| tou, editors, |     | Advances    | in Neural | Information |     | Pro-    |     |     |     |     |     |     |     |
JosephTurian,LevRatinov,andYoshuaBengio.2010.
| cessing | Systems | 21, | pages 1081–1088. |     | Curran | As- |                      |     |     |                         |     |     |     |
| ------- | ------- | --- | ---------------- | --- | ------ | --- | -------------------- | --- | --- | ----------------------- | --- | --- | --- |
|         |         |     |                  |     |        |     | Wordrepresentations: |     |     | Asimpleandgeneralmethod |     |     |     |
sociates,Inc.
|     |     |     |     |     |     |     | forsemi-supervisedlearning. |     |     |     | InProceedingsofthe |     |     |
| --- | --- | --- | --- | --- | --- | --- | --------------------------- | --- | --- | --- | ------------------ | --- | --- |
Ankur P Parikh, Oscar Ta¨ckstro¨m, Dipanjan Das, and 48thAnnualMeetingoftheAssociationforCompu-
Jakob Uszkoreit. 2016. A decomposable attention tationalLinguistics,ACL’10,pages384–394.
| modelfornaturallanguageinference. |     |     |     |     | InEMNLP. |     |                 |     |      |          |              |     |       |
| --------------------------------- | --- | --- | --- | --- | -------- | --- | --------------- | --- | ---- | -------- | ------------ | --- | ----- |
|                                   |     |     |     |     |          |     | Ashish Vaswani, |     | Noam | Shazeer, | Niki Parmar, |     | Jakob |
Jeffrey Pennington, Richard Socher, and Christo- Uszkoreit, Llion Jones, Aidan N Gomez, Lukasz
|         |          |       |        |        |         |     | Kaiser, and | Illia | Polosukhin. |     | 2017. Attention |     | is all |
| ------- | -------- | ----- | ------ | ------ | ------- | --- | ----------- | ----- | ----------- | --- | --------------- | --- | ------ |
| pher D. | Manning. | 2014. | Glove: | Global | vectors | for |             |       |             |     |                 |     |        |
wordrepresentation. InEmpiricalMethodsinNat- you need. In Advances in Neural Information Pro-
ural Language Processing (EMNLP), pages 1532– cessingSystems,pages6000–6010.
1543.
PascalVincent,HugoLarochelle,YoshuaBengio,and
Matthew Peters, Waleed Ammar, Chandra Bhagavat- Pierre-Antoine Manzagol. 2008. Extracting and
ula, and Russell Power. 2017. Semi-supervised se- composing robust features with denoising autoen-
quencetaggingwithbidirectionallanguagemodels. coders. In Proceedings of the 25th international
conferenceonMachinelearning,pages1096–1103.
InACL.
ACM.
| Matthew | Peters, | Mark | Neumann, | Mohit | Iyyer, | Matt |     |     |     |     |     |     |     |
| ------- | ------- | ---- | -------- | ----- | ------ | ---- | --- | --- | --- | --- | --- | --- | --- |
Gardner, Christopher Clark, Kenton Lee, and Luke Alex Wang, Amanpreet Singh, Julian Michael, Fe-
Zettlemoyer.2018a. Deepcontextualizedwordrep- lix Hill, Omer Levy, and Samuel Bowman. 2018a.
resentations. InNAACL. Glue:Amulti-taskbenchmarkandanalysisplatform

fornaturallanguageunderstanding. InProceedings • Additional details for our experiments are
of the 2018 EMNLP Workshop BlackboxNLP: An- presentedinAppendixB;and
alyzing and Interpreting Neural Networks for NLP,
pages353–355.
• Additional ablation studies are presented in
AppendixC.
Wei Wang, Ming Yan, and Chen Wu. 2018b. Multi-
granularity hierarchical attention fusion networks We present additional ablation studies for
forreadingcomprehensionandquestionanswering.
BERTincluding:
InProceedingsofthe56thAnnualMeetingoftheAs-
sociationforComputationalLinguistics(Volume1:
– EffectofNumberofTrainingSteps;and
Long Papers). Association for Computational Lin-
guistics. – Ablation for Different Masking Proce-
dures.
AlexWarstadt,AmanpreetSingh,andSamuelRBow-
man. 2018. Neural network acceptability judg- A AdditionalDetailsforBERT
ments. arXivpreprintarXiv:1805.12471.
A.1 IllustrationofthePre-trainingTasks
Adina Williams, Nikita Nangia, and Samuel R Bow-
man. 2018. A broad-coverage challenge corpus We provide examples of the pre-training tasks in
for sentence understanding through inference. In thefollowing.
NAACL.
Masked LM and the Masking Procedure As-
Yonghui Wu, Mike Schuster, Zhifeng Chen, Quoc V
suming the unlabeled sentence is my dog is
Le, Mohammad Norouzi, Wolfgang Macherey,
hairy,andduringtherandommaskingprocedure
Maxim Krikun, Yuan Cao, Qin Gao, Klaus
Macherey, et al. 2016. Google’s neural ma- we chose the 4-th token (which corresponding to
chinetranslationsystem: Bridgingthegapbetween hairy), our masking procedure can be further il-
human and machine translation. arXiv preprint lustratedby
arXiv:1609.08144.
• 80% of the time: Replace the word with the
Jason Yosinski, Jeff Clune, Yoshua Bengio, and Hod
[MASK] token, e.g., my dog is hairy →
Lipson.2014. Howtransferablearefeaturesindeep
neuralnetworks? InAdvancesinneuralinformation my dog is [MASK]
processingsystems,pages3320–3328.
• 10% of the time: Replace the word with a
AdamsWeiYu,DavidDohan,Minh-ThangLuong,Rui randomword,e.g.,my dog is hairy → my
Zhao,KaiChen,MohammadNorouzi,andQuocV
dog is apple
Le. 2018. QANet: Combining local convolution
with global self-attention for reading comprehen-
• 10% of the time: Keep the word un-
sion. InICLR.
changed,e.g.,my dog is hairy → my dog
RowanZellers,YonatanBisk,RoySchwartz,andYejin is hairy. The purpose of this is to bias the
Choi.2018. Swag: Alarge-scaleadversarialdataset
representation towards the actual observed
for grounded commonsense inference. In Proceed-
word.
ings of the 2018 Conference on Empirical Methods
inNaturalLanguageProcessing(EMNLP).
The advantage of this procedure is that the
YukunZhu,RyanKiros,RichZemel,RuslanSalakhut- Transformer encoder does not know which words
dinov,RaquelUrtasun,AntonioTorralba,andSanja it will be asked to predict or which have been re-
Fidler.2015. Aligningbooksandmovies: Towards
placed by random words, so it is forced to keep
story-like visual explanations by watching movies
a distributional contextual representation of ev-
and reading books. In Proceedings of the IEEE
international conference on computer vision, pages ery input token. Additionally, because random
19–27. replacement only occurs for 1.5% of all tokens
(i.e., 10% of 15%), this does not seem to harm
Appendixfor“BERT:Pre-trainingof
themodel’slanguageunderstandingcapability. In
DeepBidirectionalTransformersfor
Section C.2, we evaluate the impact this proce-
LanguageUnderstanding”
dure.
Weorganizetheappendixintothreesections: Comparedtostandardlangaugemodeltraining,
the maskedLM onlymake predictions on15% of
• Additional implementation details for BERT tokens in each batch, which suggests that more
arepresentedinAppendixA; pre-training steps may be required for the model

BERT (Ours) OpenAI GPT ELMo
T1 T2 ... TN T1 T2 ... TN T1 T2 ... TN
Trm Trm ... Trm Trm Trm ... Trm
Lstm Lstm ... Lstm Lstm Lstm ... Lstm
Trm Trm ... Trm Trm Trm ... Trm
Lstm Lstm ... Lstm Lstm Lstm ... Lstm
E1 E2 ... EN E1 E2 ... EN E1 E2 ... EN
Figure3: Differencesinpre-trainingmodelarchitectures. BERTusesabidirectionalTransformer. OpenAIGPT
usesaleft-to-rightTransformer. ELMousestheconcatenationofindependentlytrainedleft-to-rightandright-to-
left LSTMs to generate features for downstream tasks. Among the three, only BERT representations are jointly
conditioned on both left and right context in all layers. In addition to the architecture differences, BERT and
OpenAIGPTarefine-tuningapproaches,whileELMoisafeature-basedapproach.
to converge. In Section C.1 we demonstrate that epochs over the 3.3 billion word corpus. We
MLMdoesconvergemarginallyslowerthanaleft- use Adam with learning rate of 1e-4, β = 0.9,
1
to-right model (which predicts every token), but β = 0.999, L2 weight decay of 0.01, learning
2
the empirical improvements of the MLM model ratewarmupoverthefirst10,000steps,andlinear
faroutweightheincreasedtrainingcost. decayofthelearningrate. Weuseadropoutprob-
ability of 0.1 on all layers. We use a gelu acti-
Next Sentence Prediction The next sentence
vation (Hendrycks and Gimpel, 2016) rather than
prediction task can be illustrated in the following
the standard relu, following OpenAI GPT. The
examples.
training loss is the sum of the mean masked LM
likelihood and the mean next sentence prediction
Input = [CLS] the man went to [MASK] store [SEP]
likelihood.
he bought a gallon [MASK] milk [SEP] Training of BERT was performed on 4
BASE
Label = IsNext Cloud TPUs in Pod configuration (16 TPU chips
total).13 Training of BERT was performed
LARGE
on16CloudTPUs(64TPUchipstotal). Eachpre-
Input = [CLS] the man [MASK] to the store [SEP]
trainingtook4daystocomplete.
penguin [MASK] are flight ##less birds [SEP]
Longersequencesaredisproportionatelyexpen-
Label = NotNext sivebecauseattentionisquadratictothesequence
length. To speed up pretraing in our experiments,
A.2 Pre-trainingProcedure
we pre-train the model with sequence length of
Togenerateeachtraininginputsequence,wesam- 128 for 90% of the steps. Then, we train the rest
ple two spans of text from the corpus, which we 10% of the steps of sequence of 512 to learn the
refer to as “sentences” even though they are typ- positionalembeddings.
ically much longer than single sentences (but can
be shorter also). The first sentence receives the A A.3 Fine-tuningProcedure
embedding and the second receives the B embed- For fine-tuning, most model hyperparameters are
ding. 50%ofthetimeBistheactualnextsentence the same as in pre-training, with the exception of
that follows A and 50% of the time it is a random the batch size, learning rate, and number of train-
sentence,whichisdoneforthe“nextsentencepre- ing epochs. The dropout probability was always
diction”task. Theyaresampledsuchthatthecom- kept at 0.1. The optimal hyperparameter values
binedlengthis≤512tokens. TheLMmaskingis aretask-specific,butwefoundthefollowingrange
applied after WordPiece tokenization with a uni- ofpossiblevaluestoworkwellacrossalltasks:
formmaskingrateof15%,andnospecialconsid-
erationgiventopartialwordpieces. • Batchsize: 16,32
Wetrainwithbatchsizeof256sequences(256
13https://cloudplatform.googleblog.com/2018/06/Cloud-
sequences * 512 tokens = 128,000 tokens/batch)
TPU-now-offers-preemptible-pricing-and-global-
for 1,000,000 steps, which is approximately 40 availability.html

• Learningrate(Adam): 5e-5,3e-5,2e-5 Toisolatetheeffectofthesedifferences,weper-
• Numberofepochs: 2,3,4 form ablation experiments in Section 5.1 which
demonstratethatthemajorityoftheimprovements
We also observed that large data sets (e.g., areinfactcomingfromthetwopre-trainingtasks
| 100k+ | labeled | training | examples) | were | far | less |     |     |     |     |     |     |
| ----- | ------- | -------- | --------- | ---- | --- | ---- | --- | --- | --- | --- | --- | --- |
andthebidirectionalitytheyenable.
sensitivetohyperparameterchoicethansmalldata
|     |     |     |     |     |     |     | A.5 IllustrationsofFine-tuningonDifferent |     |     |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | ----------------------------------------- | --- | --- | --- | --- | --- |
sets. Fine-tuningistypicallyveryfast,soitisrea-
Tasks
| sonable | to simply | run | an exhaustive |     | search | over |     |     |     |     |     |     |
| ------- | --------- | --- | ------------- | --- | ------ | ---- | --- | --- | --- | --- | --- | --- |
the above parameters and choose the model that The illustration of fine-tuning BERT on different
performsbestonthedevelopmentset. tasks can be seen in Figure 4. Our task-specific
|     |     |     |     |     |     |     | models | are formed | by  | incorporating |     | BERT with |
| --- | --- | --- | --- | --- | --- | --- | ------ | ---------- | --- | ------------- | --- | --------- |
A.4 ComparisonofBERT,ELMo,and
|     |     |     |     |     |     |     | one additional |     | output | layer, | so a minimal | num- |
| --- | --- | --- | --- | --- | --- | --- | -------------- | --- | ------ | ------ | ------------ | ---- |
OpenAIGPT
berofparametersneedtobelearnedfromscratch.
Here we studies the differences in recent popular Among the tasks, (a) and (b) are sequence-level
representation learning models including ELMo, tasks while (c) and (d) are token-level tasks. In
OpenAI GPT and BERT. The comparisons be- the figure, E represents the input embedding, T
i
tween the model architectures are shown visually representsthecontextualrepresentationoftokeni,
in Figure 3. Note that in addition to the architec- [CLS]isthespecialsymbolforclassificationout-
turedifferences,BERTandOpenAIGPTarefine-
|     |     |     |     |     |     |     | put, and | [SEP] | is the | special | symbol | to separate |
| --- | --- | --- | --- | --- | --- | --- | -------- | ----- | ------ | ------- | ------ | ----------- |
tuningapproaches,whileELMoisafeature-based non-consecutivetokensequences.
approach.
|               |             |            |          |            |              |      | B DetailedExperimentalSetup        |     |     |     |     |     |
| ------------- | ----------- | ---------- | -------- | ---------- | ------------ | ---- | ---------------------------------- | --- | --- | --- | --- | --- |
| The           | most        | comparable | existing |            | pre-training |      |                                    |     |     |     |     |     |
| method        | to BERT     | is OpenAI  |          | GPT, which | trains       | a    |                                    |     |     |     |     |     |
|               |             |            |          |            |              |      | B.1 DetailedDescriptionsfortheGLUE |     |     |     |     |     |
| left-to-right | Transformer |            | LM       | on a large | text         | cor- |                                    |     |     |     |     |     |
BenchmarkExperiments.
pus. Infact,manyofthedesigndecisionsinBERT
|                    |     |      |     |         |          |     | Our GLUE |                            | results | in Table1 |     | are obtained |
| ------------------ | --- | ---- | --- | ------- | -------- | --- | -------- | -------------------------- | ------- | --------- | --- | ------------ |
| were intentionally |     | made | to  | make it | as close | to  |          |                            |         |           |     |              |
|                    |     |      |     |         |          |     | from     | https://gluebenchmark.com/ |         |           |     |              |
GPTaspossiblesothatthetwomethodscouldbe
|     |     |     |     |     |     |     | leaderboard |     |     |     | https://blog. |     |
| --- | --- | --- | --- | --- | --- | --- | ----------- | --- | --- | --- | ------------- | --- |
and
| minimally | compared. |     | The core | argument | of  | this |     |     |     |     |     |     |
| --------- | --------- | --- | -------- | -------- | --- | ---- | --- | --- | --- | --- | --- | --- |
openai.com/language-unsupervised.
| work is | that the | bi-directionality |     | and | the two | pre- |          |           |     |          |     |               |
| ------- | -------- | ----------------- | --- | --- | ------- | ---- | -------- | --------- | --- | -------- | --- | ------------- |
|         |          |                   |     |     |         |      | The GLUE | benchmark |     | includes |     | the following |
trainingtaskspresentedinSection3.1accountfor
datasets,thedescriptionsofwhichwereoriginally
| the majority |     | of the empirical |     | improvements, |     | but |     |     |     |     |     |     |
| ------------ | --- | ---------------- | --- | ------------- | --- | --- | --- | --- | --- | --- | --- | --- |
summarizedinWangetal.(2018a):
wedonotethatthereareseveralotherdifferences
betweenhowBERTandGPTweretrained: MNLI Multi-GenreNaturalLanguageInference
|         |            |         |                 |        |           |     | is a large-scale,               |     | crowdsourced |            | entailment   | classifi- |
| ------- | ---------- | ------- | --------------- | ------ | --------- | --- | ------------------------------- | --- | ------------ | ---------- | ------------ | --------- |
| • GPT   | is trained | on      | the BooksCorpus |        | (800M     |     |                                 |     |              |            |              |           |
|         |            |         |                 |        |           |     | cationtask(Williamsetal.,2018). |     |              |            | Givenapairof |           |
| words); |            | BERT is | trained         | on the | BooksCor- |     |                                 |     |              |            |              |           |
|         |            |         |                 |        |           |     | sentences,                      | the | goal is      | to predict | whether      | the sec-  |
pus (800M words) and Wikipedia (2,500M ond sentence is an entailment, contradiction, or
words).
neutralwithrespecttothefirstone.
• GPT uses a sentence separator ([SEP]) and QQP Quora Question Pairs is a binary classifi-
classifier token ([CLS]) which are only in- cation task where the goal is to determine if two
|          |     |                |              |            |            |        | questions              | asked | on Quora | are | semantically | equiv- |
| -------- | --- | -------------- | ------------ | ---------- | ---------- | ------ | ---------------------- | ----- | -------- | --- | ------------ | ------ |
| troduced |     | at fine-tuning |              | time; BERT |            | learns |                        |       |          |     |              |        |
| [SEP],   |     | [CLS]          | and sentence |            | A/B embed- |        | alent(Chenetal.,2018). |       |          |     |              |        |
dingsduringpre-training.
|       |     |         |        |       |        |       | QNLI      | Question | Natural      | Language |          | Inference is |
| ----- | --- | ------- | ------ | ----- | ------ | ----- | --------- | -------- | ------------ | -------- | -------- | ------------ |
|       |     |         |        |       |        |       | a version | of       | the Stanford |          | Question | Answering    |
| • GPT | was | trained | for 1M | steps | with a | batch |           |          |              |          |          |              |
size of 32,000 words; BERT was trained for Dataset (Rajpurkar et al., 2016) which has been
|     |     |     |     |     |     |     | converted | to a | binary | classification |     | task (Wang |
| --- | --- | --- | --- | --- | --- | --- | --------- | ---- | ------ | -------------- | --- | ---------- |
1Mstepswithabatchsizeof128,000words.
|     |     |     |     |     |     |     | et al., 2018a). |     | The positive |     | examples | are (ques- |
| --- | --- | --- | --- | --- | --- | --- | --------------- | --- | ------------ | --- | -------- | ---------- |
• GPT used the same learning rate of 5e-5 for tion, sentence) pairs which do contain the correct
allfine-tuningexperiments; BERTchoosesa answer, and the negative examples are (question,
task-specific fine-tuning learning rate which sentence) from the same paragraph which do not
| performsthebestonthedevelopmentset. |     |     |     |     |     |     | containtheanswer. |     |     |     |     |     |
| ----------------------------------- | --- | --- | --- | --- | --- | --- | ----------------- | --- | --- | --- | --- | --- |

Class Class
Label Label
C T 1 ... T N T [SEP] T 1 ’ ... T M ’ C T 1 T 2 ... T N
BERT BERT
E[CLS] E 1 ... E N E [SEP] E 1 ’ ... E M ’ E [CLS] E 1 E 2 ... E N
[CLS] T 1 ok ... T N ok [SEP] T 1 ok ... T M ok [[CCLLSS]] TTookk 11 Tok 2 ... Tok N
Sentence 1 Sentence 2 Single Sentence
Start/End Span O B-PER ... O
C T 1 ... T N T [SEP] T 1 ’ ... T M ’ C T 1 T 2 ... T N
BERT BERT
E[CLS] E 1 ... E N E [SEP] E 1 ’ ... E M ’ E [CLS] E 1 E 2 ... E N
[CLS] T 1 ok ... T N ok [SEP] T 1 ok ... T M ok [CLS] Tok 1 Tok 2 ... Tok N
Question Paragraph Single Sentence
Figure4: IllustrationsofFine-tuningBERTonDifferentTasks.
SST-2 The Stanford Sentiment Treebank is a for whether the sentences in the pair are semanti-
binary single-sentence classification task consist- callyequivalent(DolanandBrockett,2005).
ing of sentences extracted from movie reviews
RTE Recognizing Textual Entailment is a bi-
withhumanannotationsoftheirsentiment(Socher
nary entailment task similar to MNLI, but with
etal.,2013).
muchlesstrainingdata(Bentivoglietal.,2009).14
CoLA TheCorpusofLinguisticAcceptabilityis
abinarysingle-sentenceclassificationtask,where WNLI Winograd NLI is a small natural lan-
thegoalistopredictwhetheranEnglishsentence guage inference dataset (Levesque et al., 2011).
is linguistically “acceptable” or not (Warstadt The GLUE webpage notes that there are issues
etal.,2018). with the construction of this dataset, 15 and every
trainedsystemthat’sbeensubmittedtoGLUEhas
STS-B TheSemanticTextualSimilarityBench-
performed worse than the 65.1 baseline accuracy
mark is a collection of sentence pairs drawn from
of predicting the majority class. We therefore ex-
news headlines and other sources (Cer et al.,
clude this set to be fair to OpenAI GPT. For our
2017). They were annotated with a score from 1
GLUE submission, we always predicted the ma-
to5denotinghowsimilarthetwosentencesarein
termsofsemanticmeaning. 14Note that we only report single-task fine-tuning results
inthispaper. Amultitaskfine-tuningapproachcouldpoten-
MRPC Microsoft Research Paraphrase Corpus tially push the performance even further. For example, we
did observe substantial improvements on RTE from multi-
consists of sentence pairs automatically extracted
tasktrainingwithMNLI.
fromonlinenewssources,withhumanannotations 15https://gluebenchmark.com/faq

| jorityclass. |     |     |     |     |     |     | Note         | that the | purpose  | of  | the masking |              | strategies |
| ------------ | --- | --- | --- | --- | --- | --- | ------------ | -------- | -------- | --- | ----------- | ------------ | ---------- |
|              |     |     |     |     |     |     | is to reduce | the      | mismatch |     | between     | pre-training |            |
C AdditionalAblationStudies andfine-tuning,asthe[MASK]symbolneverap-
|     |     |     |     |     |     |     | pears during | the | fine-tuning |     | stage. | We  | report the |
| --- | --- | --- | --- | --- | --- | --- | ------------ | --- | ----------- | --- | ------ | --- | ---------- |
C.1 EffectofNumberofTrainingSteps
|        |            |      |     |          |       |       | Dev results | for  | both        | MNLI | and               | NER. | For NER, |
| ------ | ---------- | ---- | --- | -------- | ----- | ----- | ----------- | ---- | ----------- | ---- | ----------------- | ---- | -------- |
| Figure | 5 presents | MNLI | Dev | accuracy | after | fine- |             |      |             |      |                   |      |          |
|        |            |      |     |          |       |       | we report   | both | fine-tuning |      | and feature-based |      | ap-      |
tuningfromacheckpointthathasbeenpre-trained proaches, as we expect the mismatch will be am-
forksteps. Thisallowsustoanswerthefollowing plifiedforthefeature-basedapproachasthemodel
questions: will not have the chance to adjust the representa-
tions.
| 1. Question: |     | Does | BERT | really | need | such |     |     |     |     |     |     |     |
| ------------ | --- | ---- | ---- | ------ | ---- | ---- | --- | --- | --- | --- | --- | --- | --- |
a large amount of pre-training (128,000 MaskingRates DevSetResults
| words/batch              |     | * 1,000,000 |     | steps) | to achieve |     |           |     |           |      |           |               |     |
| ------------------------ | --- | ----------- | --- | ------ | ---------- | --- | --------- | --- | --------- | ---- | --------- | ------------- | --- |
|                          |     |             |     |        |            |     | MASK SAME |     | RND       | MNLI |           | NER           |     |
| highfine-tuningaccuracy? |     |             |     |        |            |     |           |     | Fine-tune |      | Fine-tune | Feature-based |     |
Answer: Yes, BERT BASE achieves almost 80% 10% 10% 84.2 95.4 94.9
1.0% additional accuracy on MNLI when 100% 0% 0% 84.3 94.9 94.0
|     |     |     |     |     |     |     | 80% | 0%  | 20% | 84.1 | 95.2 |     | 94.6 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---- | ---- | --- | ---- |
trainedon1Mstepscomparedto500ksteps.
|     |     |     |     |     |     |     | 80% | 20% | 0%  | 84.4 | 95.2 |     | 94.7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---- | ---- | --- | ---- |
|     |     |     |     |     |     |     | 0%  | 20% | 80% | 83.7 | 94.8 |     | 94.6 |
2. Question: Does MLM pre-training converge 0% 0% 100% 83.6 94.9 94.6
slowerthanLTRpre-training,sinceonly15%
|     |       |               |     |         |       |        | Table8: | Ablationoverdifferentmaskingstrategies. |     |     |     |     |     |
| --- | ----- | ------------- | --- | ------- | ----- | ------ | ------- | --------------------------------------- | --- | --- | --- | --- | --- |
| of  | words | are predicted |     | in each | batch | rather |         |                                         |     |     |     |     |     |
thaneveryword?
Answer: The MLM model does converge TheresultsarepresentedinTable8. Inthetable,
slightly slower than the LTR model. How- MASKmeansthatwereplacethetargettokenwith
ever,intermsofabsoluteaccuracytheMLM the[MASK]symbolforMLM; SAME meansthat
model begins to outperform the LTR model we keep the target token as is; RND means that
almostimmediately. we replace the target token with another random
token.
C.2 AblationforDifferentMasking The numbers in the left part of the table repre-
| Procedures |     |     |     |     |     |     | senttheprobabilitiesofthespecificstrategiesused |     |     |     |     |     |     |
| ---------- | --- | --- | --- | --- | --- | --- | ----------------------------------------------- | --- | --- | --- | --- | --- | --- |
duringMLMpre-training(BERTuses80%,10%,
| In Section | 3.1, | we mention |     | that BERT |     | uses a |           |       |      |        |       |            |     |
| ---------- | ---- | ---------- | --- | --------- | --- | ------ | --------- | ----- | ---- | ------ | ----- | ---------- | --- |
|            |      |            |     |           |     |        | 10%). The | right | part | of the | paper | represents | the |
mixedstrategyformaskingthetargettokenswhen
|              |            |          |           |          |             |       | Dev set        | results. | For      | the feature-based |        |         | approach, |
| ------------ | ---------- | -------- | --------- | -------- | ----------- | ----- | -------------- | -------- | -------- | ----------------- | ------ | ------- | --------- |
| pre-training |            | with the | masked    | language |             | model |                |          |          |                   |        |         |           |
|              |            |          |           |          |             |       | we concatenate |          | the last | 4                 | layers | of BERT | as the    |
| (MLM)        | objective. | The      | following | is       | an ablation |       |                |          |          |                   |        |         |           |
features,whichwasshowntobethebestapproach
| study to | evaluate | the | effect | of different | masking |     |     |     |     |     |     |     |     |
| -------- | -------- | --- | ------ | ------------ | ------- | --- | --- | --- | --- | --- | --- | --- | --- |
inSection5.3.
strategies.
Fromthetableitcanbeseenthatfine-tuningis
surprisinglyrobusttodifferentmaskingstrategies.
However,asexpected,usingonlytheMASKstrat-
84
|     |     |     |     |     |     |     | egy was | problematic |     | when | applying | the | feature- |
| --- | --- | --- | --- | --- | --- | --- | ------- | ----------- | --- | ---- | -------- | --- | -------- |
ycaruccAveDILNM
82
|     |     |     |     |     |     |     | based approach |          | to NER.  | Interestingly, |      | using | only     |
| --- | --- | --- | --- | --- | --- | --- | -------------- | -------- | -------- | -------------- | ---- | ----- | -------- |
|     |     |     |     |     |     |     | the RND        | strategy | performs |                | much | worse | than our |
80
strategyaswell.
78
BERTBASE(MaskedLM)
76
BERTBASE(Left-to-Right)
|     | 200 | 400 | 600 | 800 | 1,000 |     |     |     |     |     |     |     |     |
| --- | --- | --- | --- | --- | ----- | --- | --- | --- | --- | --- | --- | --- | --- |
Pre-trainingSteps(Thousands)
| Figure5:   | Ablationovernumberoftrainingsteps. |          |           |                  |     | This     |     |     |     |     |     |     |     |
| ---------- | ---------------------------------- | -------- | --------- | ---------------- | --- | -------- | --- | --- | --- | --- | --- | --- | --- |
| shows the  | MNLI                               | accuracy | after     | fine-tuning,     |     | starting |     |     |     |     |     |     |     |
| from model | parameters                         |          | that have | been pre-trained |     | for      |     |     |     |     |     |     |     |
ksteps. Thex-axisisthevalueofk.