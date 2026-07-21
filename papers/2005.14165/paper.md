Language Models are Few-Shot Learners
TomB.Brown∗ BenjaminMann∗ NickRyder∗ MelanieSubbiah∗
JaredKaplan† PrafullaDhariwal ArvindNeelakantan PranavShyam GirishSastry
AmandaAskell SandhiniAgarwal ArielHerbert-Voss GretchenKrueger TomHenighan
RewonChild AdityaRamesh DanielM.Ziegler JeffreyWu ClemensWinter
ChristopherHesse MarkChen EricSigler MateuszLitwin ScottGray
BenjaminChess JackClark ChristopherBerner
SamMcCandlish AlecRadford IlyaSutskever DarioAmodei
OpenAI
Abstract
RecentworkhasdemonstratedsubstantialgainsonmanyNLPtasksandbenchmarksbypre-training
onalargecorpusoftextfollowedbyfine-tuningonaspecifictask. Whiletypicallytask-agnostic
inarchitecture,thismethodstillrequirestask-specificfine-tuningdatasetsofthousandsortensof
thousandsofexamples. Bycontrast,humanscangenerallyperformanewlanguagetaskfromonly
afewexamplesorfromsimpleinstructions–somethingwhichcurrentNLPsystemsstilllargely
struggle to do. Here we show that scaling up language models greatly improves task-agnostic,
few-shot performance, sometimes even reaching competitiveness with prior state-of-the-art fine-
tuningapproaches. Specifically,wetrainGPT-3,anautoregressivelanguagemodelwith175billion
parameters, 10x more than any previous non-sparse language model, and test its performance in
the few-shot setting. For all tasks, GPT-3 is applied without any gradient updates or fine-tuning,
withtasksandfew-shotdemonstrationsspecifiedpurelyviatextinteractionwiththemodel. GPT-3
achievesstrongperformanceonmanyNLPdatasets,includingtranslation,question-answering,and
clozetasks,aswellasseveraltasksthatrequireon-the-flyreasoningordomainadaptation,suchas
unscramblingwords,usinganovelwordinasentence,orperforming3-digitarithmetic. Atthesame
time,wealsoidentifysomedatasetswhereGPT-3’sfew-shotlearningstillstruggles,aswellassome
datasetswhereGPT-3facesmethodologicalissuesrelatedtotrainingonlargewebcorpora. Finally,
wefindthatGPT-3cangeneratesamplesofnewsarticleswhichhumanevaluatorshavedifficulty
distinguishingfromarticleswrittenbyhumans. Wediscussbroadersocietalimpactsofthisfinding
andofGPT-3ingeneral.
∗Equalcontribution
†JohnsHopkinsUniversity,OpenAI
Authorcontributionslistedatendofpaper.
0202
luJ
22
]LC.sc[
4v56141.5002:viXra

Contents
1 Introduction 3
2 Approach 6
2.1 ModelandArchitectures . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 8
2.2 TrainingDataset. . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 8
2.3 TrainingProcess . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 9
2.4 Evaluation . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 10
3 Results 10
3.1 LanguageModeling,Cloze,andCompletionTasks . . . . . . . . . . . . . . . . . . . . . . . . . . . 11
3.2 ClosedBookQuestionAnswering . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 13
3.3 Translation . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 14
3.4 Winograd-StyleTasks . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 16
3.5 CommonSenseReasoning . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 17
3.6 ReadingComprehension . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 18
3.7 SuperGLUE . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 18
3.8 NLI . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 20
3.9 SyntheticandQualitativeTasks . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 21
4 MeasuringandPreventingMemorizationOfBenchmarks 29
5 Limitations 33
6 BroaderImpacts 34
6.1 MisuseofLanguageModels . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 35
6.2 Fairness,Bias,andRepresentation . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 36
6.3 EnergyUsage . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 39
7 RelatedWork 39
8 Conclusion 40
A DetailsofCommonCrawlFiltering 43
B DetailsofModelTraining 43
C DetailsofTestSetContaminationStudies 43
D TotalComputeUsedtoTrainLanguageModels 46
E HumanQualityAssessmentofSyntheticNewsArticles 46
F AdditionalSamplesfromGPT-3 48
G DetailsofTaskPhrasingandSpecifications 50
H ResultsonAllTasksforAllModelSizes 63
2

1 Introduction
Recentyearshavefeaturedatrendtowardspre-trainedlanguagerepresentationsinNLPsystems,appliedinincreasingly
flexibleandtask-agnosticwaysfordownstreamtransfer. First,single-layerrepresentationswerelearnedusingword
vectors[MCCD13,PSM14]andfedtotask-specificarchitectures,thenRNNswithmultiplelayersofrepresentations
andcontextualstatewereusedtoformstrongerrepresentations[DL15,MBXS17,PNZtY18](thoughstillappliedto
task-specificarchitectures),andmorerecentlypre-trainedrecurrentortransformerlanguagemodels[VSP+17]have
beendirectlyfine-tuned,entirelyremovingtheneedfortask-specificarchitectures[RNSS18,DCLT18,HR18].
ThislastparadigmhasledtosubstantialprogressonmanychallengingNLPtaskssuchasreadingcomprehension,
questionanswering,textualentailment,andmanyothers,andhascontinuedtoadvancebasedonnewarchitectures
andalgorithms[RSR+19,LOG+19,YDY+19,LCG+19]. However,amajorlimitationtothisapproachisthatwhile
thearchitectureistask-agnostic,thereisstillaneedfortask-specificdatasetsandtask-specificfine-tuning: toachieve
strongperformanceonadesiredtasktypicallyrequiresfine-tuningonadatasetofthousandstohundredsofthousands
ofexamplesspecifictothattask. Removingthislimitationwouldbedesirable,forseveralreasons.
First, from a practical perspective, the need for a large dataset of labeled examples for every new task limits the
applicabilityoflanguagemodels. Thereexistsaverywiderangeofpossibleusefullanguagetasks, encompassing
anythingfromcorrectinggrammar,togeneratingexamplesofanabstractconcept,tocritiquingashortstory. Formany
ofthesetasksitisdifficulttocollectalargesupervisedtrainingdataset,especiallywhentheprocessmustberepeated
foreverynewtask.
Second,thepotentialtoexploitspuriouscorrelationsintrainingdatafundamentallygrowswiththeexpressiveness
of the model and the narrowness of the training distribution. This can create problems for the pre-training plus
fine-tuningparadigm,wheremodelsaredesignedtobelargetoabsorbinformationduringpre-training,butarethen
fine-tunedonverynarrowtaskdistributions. Forinstance[HLW+20]observethatlargermodelsdonotnecessarily
generalizebetterout-of-distribution.Thereisevidencethatsuggeststhatthegeneralizationachievedunderthisparadigm
canbepoorbecausethemodelisoverlyspecifictothetrainingdistributionanddoesnotgeneralizewelloutsideit
[YdC+19,MPL19]. Thus,theperformanceoffine-tunedmodelsonspecificbenchmarks,evenwhenitisnominallyat
human-level,mayexaggerateactualperformanceontheunderlyingtask[GSL+18,NK19].
Third, humans do not require large supervised datasets to learn most language tasks – a brief directive in natural
language(e.g. “pleasetellmeifthissentencedescribessomethinghappyorsomethingsad”)oratmostatinynumber
ofdemonstrations(e.g. “herearetwoexamplesofpeopleactingbrave;pleasegiveathirdexampleofbravery”)isoften
Figure1.1: Languagemodelmeta-learning. Duringunsupervisedpre-training,alanguagemodeldevelopsabroad
setofskillsandpatternrecognitionabilities. Itthenusestheseabilitiesatinferencetimetorapidlyadapttoorrecognize
thedesiredtask. Weusetheterm“in-contextlearning”todescribetheinnerloopofthisprocess,whichoccurswithin
theforward-passuponeachsequence. Thesequencesinthisdiagramarenotintendedtoberepresentativeofthedataa
modelwouldseeduringpre-training,butareintendedtoshowthattherearesometimesrepeatedsub-tasksembedded
withinasinglesequence.
3

Figure1.2:Largermodelsmakeincreasinglyefficientuseofin-contextinformation. Weshowin-contextlearning
performanceonasimpletaskrequiringthemodeltoremoverandomsymbolsfromaword,bothwithandwithouta
naturallanguagetaskdescription(seeSec.3.9.2).Thesteeper“in-contextlearningcurves”forlargemodelsdemonstrate
improvedabilitytolearnataskfromcontextualinformation. Weseequalitativelysimilarbehavioracrossawiderange
oftasks.
sufficienttoenableahumantoperformanewtasktoatleastareasonabledegreeofcompetence. Asidefrompointing
toaconceptuallimitationinourcurrentNLPtechniques,thisadaptabilityhaspracticaladvantages–itallowshumans
toseamlesslymixtogetherorswitchbetweenmanytasksandskills,forexampleperformingadditionduringalengthy
dialogue. Tobebroadlyuseful,wewouldsomedaylikeourNLPsystemstohavethissamefluidityandgenerality.
Onepotentialroutetowardsaddressingtheseissuesismeta-learning1–whichinthecontextoflanguagemodelsmeans
themodeldevelopsabroadsetofskillsandpatternrecognitionabilitiesattrainingtime,andthenusesthoseabilities
atinferencetimetorapidlyadapttoorrecognizethedesiredtask(illustratedinFigure1.1). Recentwork[RWC+19]
attemptstodothisviawhatwecall“in-contextlearning”,usingthetextinputofapretrainedlanguagemodelasaform
oftaskspecification: themodelisconditionedonanaturallanguageinstructionand/orafewdemonstrationsofthetask
andisthenexpectedtocompletefurtherinstancesofthetasksimplybypredictingwhatcomesnext.
Whileithasshownsomeinitialpromise,thisapproachstillachievesresultsfarinferiortofine-tuning–forexample
[RWC+19]achievesonly4%onNaturalQuestions,andevenits55F1CoQaresultisnowmorethan35pointsbehind
thestateoftheart. Meta-learningclearlyrequiressubstantialimprovementinordertobeviableasapracticalmethodof
solvinglanguagetasks.
Another recent trend in language modeling may offer a way forward. In recent years the capacity of transformer
language models has increased substantially, from 100 million parameters [RNSS18], to 300 million parameters
[DCLT18],to1.5billionparameters[RWC+19],to8billionparameters[SPP+19],11billionparameters[RSR+19],
andfinally17billionparameters[Tur20]. Eachincreasehasbroughtimprovementsintextsynthesisand/ordownstream
NLPtasks,andthereisevidencesuggestingthatlogloss,whichcorrelateswellwithmanydownstreamtasks,followsa
smoothtrendofimprovementwithscale[KMH+20]. Sincein-contextlearninginvolvesabsorbingmanyskillsand
taskswithintheparametersofthemodel,itisplausiblethatin-contextlearningabilitiesmightshowsimilarlystrong
gainswithscale.
1Inthecontextoflanguagemodelsthishassometimesbeencalled“zero-shottransfer”,butthistermispotentiallyambiguous:
the method is “zero-shot” in the sense that no gradient updates are performed, but it often involves providing inference-time
demonstrationstothemodel,soisnottrulylearningfromzeroexamples.Toavoidthisconfusion,weusetheterm“meta-learning”
tocapturetheinner-loop/outer-loopstructureofthegeneralmethod, andtheterm“incontext-learning”torefertotheinner
loopofmeta-learning. Wefurtherspecializethedescriptionto“zero-shot”,“one-shot”,or“few-shot”dependingonhowmany
demonstrationsareprovidedatinferencetime.Thesetermsareintendedtoremainagnosticonthequestionofwhetherthemodel
learnsnewtasksfromscratchatinferencetimeorsimplyrecognizespatternsseenduringtraining–thisisanimportantissuewhich
wediscusslaterinthepaper,but“meta-learning”isintendedtoencompassbothpossibilities,andsimplydescribestheinner-outer
loopstructure.
4

Figure1.3: Aggregateperformanceforall42accuracy-denominatedbenchmarks Whilezero-shotperformance
improvessteadilywithmodelsize,few-shotperformanceincreasesmorerapidly,demonstratingthatlargermodelsare
moreproficientatin-contextlearning. SeeFigure3.8foramoredetailedanalysisonSuperGLUE,astandardNLP
benchmarksuite.
Inthispaper,wetestthishypothesisbytraininga175billionparameterautoregressivelanguagemodel,whichwecall
GPT-3,andmeasuringitsin-contextlearningabilities. Specifically,weevaluateGPT-3onovertwodozenNLPdatasets,
aswellasseveralnoveltasksdesignedtotestrapidadaptationtotasksunlikelytobedirectlycontainedinthetraining
set. Foreachtask,weevaluateGPT-3under3conditions: (a)“few-shotlearning”,orin-contextlearningwherewe
allowasmanydemonstrationsaswillfitintothemodel’scontextwindow(typically10to100),(b)“one-shotlearning”,
whereweallowonlyonedemonstration,and(c)“zero-shot”learning,wherenodemonstrationsareallowedandonly
aninstructioninnaturallanguageisgiventothemodel. GPT-3couldalsoinprinciplebeevaluatedinthetraditional
fine-tuningsetting,butweleavethistofuturework.
Figure1.2illustratestheconditionswestudy,andshowsfew-shotlearningofasimpletaskrequiringthemodelto
removeextraneoussymbolsfromaword. Modelperformanceimproveswiththeadditionofanaturallanguagetask
description,andwiththenumberofexamplesinthemodel’scontext,K. Few-shotlearningalsoimprovesdramatically
withmodelsize. Thoughtheresultsinthiscaseareparticularlystriking,thegeneraltrendswithbothmodelsizeand
numberofexamplesin-contextholdformosttaskswestudy. Weemphasizethatthese“learning”curvesinvolveno
gradientupdatesorfine-tuning,justincreasingnumbersofdemonstrationsgivenasconditioning.
Broadly,onNLPtasksGPT-3achievespromisingresultsinthezero-shotandone-shotsettings,andinthethefew-shot
settingissometimescompetitivewithorevenoccasionallysurpassesstate-of-the-art(despitestate-of-the-artbeingheld
byfine-tunedmodels). Forexample,GPT-3achieves81.5F1onCoQAinthezero-shotsetting,84.0F1onCoQAin
theone-shotsetting,85.0F1inthefew-shotsetting. Similarly,GPT-3achieves64.3%accuracyonTriviaQAinthe
zero-shotsetting,68.0%intheone-shotsetting,and71.2%inthefew-shotsetting,thelastofwhichisstate-of-the-art
relativetofine-tunedmodelsoperatinginthesameclosed-booksetting.
GPT-3alsodisplaysone-shotandfew-shotproficiencyattasksdesignedtotestrapidadaptionoron-the-flyreasoning,
which include unscrambling words, performing arithmetic, and using novel words in a sentence after seeing them
definedonlyonce. Wealsoshowthatinthefew-shotsetting,GPT-3cangeneratesyntheticnewsarticleswhichhuman
evaluatorshavedifficultydistinguishingfromhuman-generatedarticles.
Atthesametime,wealsofindsometasksonwhichfew-shotperformancestruggles,evenatthescaleofGPT-3. This
includesnaturallanguageinferencetasksliketheANLIdataset,andsomereadingcomprehensiondatasetslikeRACE
orQuAC.BypresentingabroadcharacterizationofGPT-3’sstrengthsandweaknesses,includingtheselimitations,we
hopetostimulatestudyoffew-shotlearninginlanguagemodelsanddrawattentiontowhereprogressismostneeded.
AheuristicsenseoftheoverallresultscanbeseeninFigure1.3,whichaggregatesthevarioustasks(thoughitshould
notbeseenasarigorousormeaningfulbenchmarkinitself).
5

Wealsoundertakeasystematicstudyof“datacontamination”–agrowingproblemwhentraininghighcapacitymodels
ondatasetssuchasCommonCrawl, whichcanpotentiallyincludecontentfromtestdatasetssimplybecausesuch
contentoftenexistsontheweb. Inthispaperwedevelopsystematictoolstomeasuredatacontaminationandquantify
itsdistortingeffects. AlthoughwefindthatdatacontaminationhasaminimaleffectonGPT-3’sperformanceonmost
datasets,wedoidentifyafewdatasetswhereitcouldbeinflatingresults,andweeitherdonotreportresultsonthese
datasetsorwenotethemwithanasterisk,dependingontheseverity.
Inadditiontoalltheabove,wealsotrainaseriesofsmallermodels(rangingfrom125millionparametersto13billion
parameters)inordertocomparetheirperformancetoGPT-3inthezero,oneandfew-shotsettings. Broadly,formost
taskswefindrelativelysmoothscalingwithmodelcapacityinallthreesettings;onenotablepatternisthatthegap
betweenzero-,one-,andfew-shotperformanceoftengrowswithmodelcapacity,perhapssuggestingthatlargermodels
aremoreproficientmeta-learners.
Finally,giventhebroadspectrumofcapabilitiesdisplayedbyGPT-3,wediscussconcernsaboutbias,fairness,and
broadersocietalimpacts,andattemptapreliminaryanalysisofGPT-3’scharacteristicsinthisregard.
Theremainderofthispaperisorganizedasfollows. InSection2,wedescribeourapproachandmethodsfortraining
GPT-3andevaluatingit. Section3presentsresultsonthefullrangeoftasksinthezero-,one-andfew-shotsettings.
Section4addressesquestionsofdatacontamination(train-testoverlap). Section5discusseslimitationsofGPT-3.
Section6discussesbroaderimpacts. Section7reviewsrelatedworkandSection8concludes.
2 Approach
Ourbasicpre-trainingapproach,includingmodel,data,andtraining,issimilartotheprocessdescribedin[RWC+19],
withrelativelystraightforwardscalingupofthemodelsize,datasetsizeanddiversity,andlengthoftraining. Ouruse
ofin-contextlearningisalsosimilarto[RWC+19],butinthisworkwesystematicallyexploredifferentsettingsfor
learningwithinthecontext. Therefore,westartthissectionbyexplicitlydefiningandcontrastingthedifferentsettings
thatwewillbeevaluatingGPT-3onorcouldinprincipleevaluateGPT-3on. Thesesettingscanbeseenaslyingona
spectrumofhowmuchtask-specificdatatheytendtorelyon. Specifically,wecanidentifyatleastfourpointsonthis
spectrum(seeFigure2.1foranillustration):
• Fine-Tuning(FT)hasbeenthemostcommonapproachinrecentyears,andinvolvesupdatingtheweightsof
apre-trainedmodelbytrainingonasuperviseddatasetspecifictothedesiredtask. Typicallythousandsto
hundredsofthousandsoflabeledexamplesareused. Themainadvantageoffine-tuningisstrongperformance
onmanybenchmarks. Themaindisadvantagesaretheneedforanewlargedatasetforeverytask,thepotential
for poor generalization out-of-distribution [MPL19], and the potential to exploit spurious features of the
trainingdata[GSL+18,NK19],potentiallyresultinginanunfaircomparisonwithhumanperformance. In
thisworkwedonotfine-tuneGPT-3becauseourfocusisontask-agnosticperformance,butGPT-3canbe
fine-tunedinprincipleandthisisapromisingdirectionforfuturework.
• Few-Shot(FS) is theterm wewill usein thisworkto referto thesetting wherethe modelis givena few
demonstrationsofthetaskatinferencetimeasconditioning[RWC+19],butnoweightupdatesareallowed.
AsshowninFigure2.1,foratypicaldatasetanexamplehasacontextandadesiredcompletion(forexample
anEnglishsentenceandtheFrenchtranslation),andfew-shotworksbygivingK examplesofcontextand
completion,andthenonefinalexampleofcontext,withthemodelexpectedtoprovidethecompletion. We
typicallysetK intherangeof10to100asthisishowmanyexamplescanfitinthemodel’scontextwindow
(n =2048). Themainadvantagesoffew-shotareamajorreductionintheneedfortask-specificdataand
ctx
reducedpotentialtolearnanoverlynarrowdistributionfromalargebutnarrowfine-tuningdataset. Themain
disadvantageisthatresultsfromthismethodhavesofarbeenmuchworsethanstate-of-the-artfine-tuned
models. Also, a small amount of task specific data is still required. As indicated by the name, few-shot
learningasdescribedhereforlanguagemodelsisrelatedtofew-shotlearningasusedinothercontextsin
ML[HYC01,VBL+16]–bothinvolvelearningbasedonabroaddistributionoftasks(inthiscaseimplicitin
thepre-trainingdata)andthenrapidlyadaptingtoanewtask.
• One-Shot(1S)isthesameasfew-shotexceptthatonlyonedemonstrationisallowed,inadditiontoanatural
languagedescriptionofthetask,asshowninFigure1. Thereasontodistinguishone-shotfromfew-shotand
zero-shot(below)isthatitmostcloselymatchesthewayinwhichsometasksarecommunicatedtohumans.
Forexample,whenaskinghumanstogenerateadatasetonahumanworkerservice(forexampleMechanical
Turk),itiscommontogiveonedemonstrationofthetask. Bycontrastitissometimesdifficulttocommunicate
thecontentorformatofataskifnoexamplesaregiven.
6

Figure 2.1: Zero-shot, one-shot and few-shot, contrasted with traditional fine-tuning. The panels above show
fourmethodsforperformingataskwithalanguagemodel–fine-tuningisthetraditionalmethod,whereaszero-,one-,
andfew-shot, whichwestudyinthiswork, requirethemodeltoperformthetaskwithonlyforwardpassesattest
time. Wetypicallypresentthemodelwithafewdozenexamplesinthefewshotsetting. Exactphrasingsforalltask
descriptions,examplesandpromptscanbefoundinAppendixG.
• Zero-Shot(0S)isthesameasone-shotexceptthatnodemonstrationsareallowed,andthemodelisonlygiven
anaturallanguageinstructiondescribingthetask. Thismethodprovidesmaximumconvenience,potentialfor
robustness,andavoidanceofspuriouscorrelations(unlesstheyoccurverybroadlyacrossthelargecorpusof
pre-trainingdata),butisalsothemostchallengingsetting. Insomecasesitmayevenbedifficultforhumans
tounderstandtheformatofthetaskwithoutpriorexamples,sothissettingisinsomecases“unfairlyhard”.
Forexample,ifsomeoneisaskedto“makeatableofworldrecordsforthe200mdash”,thisrequestcanbe
ambiguous,asitmaynotbeclearexactlywhatformatthetableshouldhaveorwhatshouldbeincluded(and
evenwithcarefulclarification,understandingpreciselywhatisdesiredcanbedifficult). Nevertheless,forat
leastsomesettingszero-shotisclosesttohowhumansperformtasks–forexample,inthetranslationexample
inFigure2.1,ahumanwouldlikelyknowwhattodofromjustthetextinstruction.
Figure 2.1 shows the four methods using the example of translating English to French. In this paper we focus on
zero-shot, one-shot and few-shot, with the aim of comparing them not as competing alternatives, but as different
problemsettingswhichofferavaryingtrade-offbetweenperformanceonspecificbenchmarksandsampleefficiency.
Weespeciallyhighlightthefew-shotresultsasmanyofthemareonlyslightlybehindstate-of-the-artfine-tunedmodels.
Ultimately,however,one-shot,orevensometimeszero-shot,seemlikethefairestcomparisonstohumanperformance,
andareimportanttargetsforfuturework.
Sections2.1-2.3belowgivedetailsonourmodels,trainingdata,andtrainingprocessrespectively. Section2.4discusses
thedetailsofhowwedofew-shot,one-shot,andzero-shotevaluations.
7

| ModelName  | n      | n d          | n d        | BatchSize | LearningRate |
| ---------- | ------ | ------------ | ---------- | --------- | ------------ |
|            | params | layers model | heads head |           |              |
| GPT-3Small | 125M   | 12 768       | 12 64      | 0.5M      | 6.0×10−4     |
3.0×10−4
| GPT-3Medium | 350M | 24 1024 | 16 64  | 0.5M |          |
| ----------- | ---- | ------- | ------ | ---- | -------- |
| GPT-3Large  | 760M | 24 1536 | 16 96  | 0.5M | 2.5×10−4 |
| GPT-3XL     | 1.3B | 24 2048 | 24 128 | 1M   | 2.0×10−4 |
| GPT-32.7B   | 2.7B | 32 2560 | 32 80  | 1M   | 1.6×10−4 |
1.2×10−4
| GPT-36.7B          | 6.7B   | 32 4096  | 32 128 | 2M   |          |
| ------------------ | ------ | -------- | ------ | ---- | -------- |
| GPT-313B           | 13.0B  | 40 5140  | 40 128 | 2M   | 1.0×10−4 |
| GPT-3175Bor“GPT-3” | 175.0B | 96 12288 | 96 128 | 3.2M | 0.6×10−4 |
Table2.1: Sizes,architectures,andlearninghyper-parameters(batchsizeintokensandlearningrate)ofthemodels
whichwetrained. Allmodelsweretrainedforatotalof300billiontokens.
2.1 ModelandArchitectures
WeusethesamemodelandarchitectureasGPT-2[RWC+19],includingthemodifiedinitialization,pre-normalization,
andreversibletokenizationdescribedtherein,withtheexceptionthatweusealternatingdenseandlocallybandedsparse
attentionpatternsinthelayersofthetransformer,similartotheSparseTransformer[CGRS19].Tostudythedependence
ofMLperformanceonmodelsize,wetrain8differentsizesofmodel,rangingoverthreeordersofmagnitudefrom125
millionparametersto175billionparameters,withthelastbeingthemodelwecallGPT-3. Previouswork[KMH+20]
suggeststhatwithenoughtrainingdata,scalingofvalidationlossshouldbeapproximatelyasmoothpowerlawasa
functionofsize;trainingmodelsofmanydifferentsizesallowsustotestthishypothesisbothforvalidationlossandfor
downstreamlanguagetasks.
Table2.1showsthesizesandarchitecturesofour8models. Heren isthetotalnumberoftrainableparameters,
params
n is the total number of layers, d is the number of units in each bottleneck layer (we always have the
| layers | model |     |     |     |     |
| ------ | ----- | --- | --- | --- | --- |
feedforwardlayerfourtimesthesizeofthebottlenecklayer,d = 4∗d ),andd isthedimensionofeach
|     |     |     | ff model | head |     |
| --- | --- | --- | -------- | ---- | --- |
attentionhead. Allmodelsuseacontextwindowofn =2048tokens. WepartitionthemodelacrossGPUsalong
ctx
both the depth and width dimension in order to minimize data-transfer between nodes. The precise architectural
parametersforeachmodelarechosenbasedoncomputationalefficiencyandload-balancinginthelayoutofmodels
acrossGPU’s. Previouswork[KMH+20]suggeststhatvalidationlossisnotstronglysensitivetotheseparameters
withinareasonablybroadrange.
2.2 TrainingDataset
Datasetsforlanguagemodelshaverapidlyexpanded,culminatingintheCommonCrawldataset2[RSR+19]constituting
nearlyatrillionwords. Thissizeofdatasetissufficienttotrainourlargestmodelswithouteverupdatingonthesame
sequencetwice. However,wehavefoundthatunfilteredorlightlyfilteredversionsofCommonCrawltendtohave
lowerqualitythanmorecurateddatasets. Therefore,wetook3stepstoimprovetheaveragequalityofourdatasets:
(1)wedownloadedandfilteredaversionofCommonCrawlbasedonsimilaritytoarangeofhigh-qualityreference
corpora,(2)weperformedfuzzydeduplicationatthedocumentlevel,withinandacrossdatasets,topreventredundancy
andpreservetheintegrityofourheld-outvalidationsetasanaccuratemeasureofoverfitting,and(3)wealsoadded
knownhigh-qualityreferencecorporatothetrainingmixtoaugmentCommonCrawlandincreaseitsdiversity.
Detailsofthefirsttwopoints(processingofCommonCrawl)aredescribedinAppendixA.Forthethird,weadded
includinganexpandedversionoftheWebTextdataset[RWC+19],
severalcuratedhigh-qualitydatasets, collected
byscrapinglinksoveralongerperiodoftime,andfirstdescribedin[KMH+20],twointernet-basedbookscorpora
(Books1andBooks2)andEnglish-languageWikipedia.
Table2.2showsthefinalmixtureofdatasetsthatweusedintraining. TheCommonCrawldatawasdownloadedfrom
41shardsofmonthlyCommonCrawlcovering2016to2019,constituting45TBofcompressedplaintextbeforefiltering
and570GBafterfiltering,roughlyequivalentto400billionbyte-pair-encodedtokens. Notethatduringtraining,datasets
arenotsampledinproportiontotheirsize,butratherdatasetsweviewashigher-qualityaresampledmorefrequently,
suchthatCommonCrawlandBooks2datasetsaresampledlessthanonceduringtraining,buttheotherdatasetsare
sampled2-3times. Thisessentiallyacceptsasmallamountofoverfittinginexchangeforhigherqualitytrainingdata.
2https://commoncrawl.org/the-data/
8

Figure2.2:Totalcomputeusedduringtraining.BasedontheanalysisinScalingLawsForNeuralLanguageModels
[KMH+20]wetrainmuchlargermodelsonmanyfewertokensthanistypical.
Asaconsequence,althoughGPT-33B
isalmost10xlargerthanRoBERTa-Large(355Mparams),bothmodelstookroughly50petaflop/s-daysofcompute
duringpre-training. MethodologyforthesecalculationscanbefoundinAppendixD.
|                       | Quantity   | Weightin    | Epochselapsedwhen     |
| --------------------- | ---------- | ----------- | --------------------- |
| Dataset               | (tokens)   | trainingmix | trainingfor300Btokens |
| CommonCrawl(filtered) | 410billion | 60%         | 0.44                  |
| WebText2              | 19billion  | 22%         | 2.9                   |
| Books1                | 12billion  | 8%          | 1.9                   |
| Books2                | 55billion  | 8%          | 0.43                  |
| Wikipedia             | 3billion   | 3%          | 3.4                   |
Table2.2: DatasetsusedtotrainGPT-3. “Weightintrainingmix”referstothefractionofexamplesduringtraining
thataredrawnfromagivendataset,whichweintentionallydonotmakeproportionaltothesizeofthedataset. Asa
result,whenwetrainfor300billiontokens,somedatasetsareseenupto3.4timesduringtrainingwhileotherdatasets
areseenlessthanonce.
Amajormethodologicalconcernwithlanguagemodelspretrainedonabroadswathofinternetdata,particularlylarge
modelswiththecapacitytomemorizevastamountsofcontent,ispotentialcontaminationofdownstreamtasksby
havingtheirtestordevelopmentsetsinadvertentlyseenduringpre-training. Toreducesuchcontamination,wesearched
forandattemptedtoremoveanyoverlapswiththedevelopmentandtestsetsofallbenchmarksstudiedinthispaper.
Unfortunately,abuginthefilteringcausedustoignoresomeoverlaps,andduetothecostoftrainingitwasnotfeasible
toretrainthemodel. InSection4wecharacterizetheimpactoftheremainingoverlaps,andinfutureworkwewill
moreaggressivelyremovedatacontamination.
2.3 TrainingProcess
Asfoundin[KMH+20,MKAT18],largermodelscantypicallyusealargerbatchsize,butrequireasmallerlearning
rate. Wemeasurethegradientnoisescaleduringtraininganduseittoguideourchoiceofbatchsize[MKAT18]. Table
2.1showstheparametersettingsweused. Totrainthelargermodelswithoutrunningoutofmemory,weuseamixture
ofmodelparallelismwithineachmatrixmultiplyandmodelparallelismacrossthelayersofthenetwork. Allmodels
weretrainedonV100GPU’sonpartofahigh-bandwidthclusterprovidedbyMicrosoft. Detailsofthetrainingprocess
andhyperparametersettingsaredescribedinAppendixB.
9

2.4 Evaluation
Forfew-shotlearning,weevaluateeachexampleintheevaluationsetbyrandomlydrawingK examplesfromthat
task’strainingsetasconditioning,delimitedby1or2newlinesdependingonthetask. ForLAMBADAandStorycloze
thereisnosupervisedtrainingsetavailablesowedrawconditioningexamplesfromthedevelopmentsetandevaluate
onthetestset. ForWinograd(theoriginal,notSuperGLUEversion)thereisonlyonedataset,sowedrawconditioning
examplesdirectlyfromit.
K canbeanyvaluefrom0tothemaximumamountallowedbythemodel’scontextwindow,whichisn =2048
ctx
forallmodelsandtypicallyfits10to100examples. LargervaluesofK areusuallybutnotalwaysbetter,sowhena
separatedevelopmentandtestsetareavailable,weexperimentwithafewvaluesofK onthedevelopmentsetandthen
runthebestvalueonthetestset. Forsometasks(seeAppendixG)wealsouseanaturallanguagepromptinadditionto
(orforK =0,insteadof)demonstrations.
Ontasksthatinvolvechoosingonecorrectcompletionfromseveraloptions(multiplechoice),weprovideK examples
of context plus correct completion, followed by one example of context only, and compare the LM likelihood of
eachcompletion. Formosttaskswecomparetheper-tokenlikelihood(tonormalizeforlength),howeveronasmall
numberofdatasets(ARC,OpenBookQA,andRACE)wegainadditionalbenefitasmeasuredonthedevelopmentset
bynormalizingbytheunconditionalprobabilityofeachcompletion,bycomputing P(completion|context) ,where
P(completion|answer context)
answer contextisthestring"Answer: "or"A: "andisusedtopromptthatthecompletionshouldbeananswer
butisotherwisegeneric.
Ontasksthatinvolvebinaryclassification,wegivetheoptionsmoresemanticallymeaningfulnames(e.g. “True”or
“False”ratherthan0or1)andthentreatthetasklikemultiplechoice;wealsosometimesframethetasksimilartowhat
isdoneby[RSR+19](seeAppendixG)fordetails.
Ontaskswithfree-formcompletion,weusebeamsearchwiththesameparametersas[RSR+19]: abeamwidthof4
andalengthpenaltyofα=0.6. WescorethemodelusingF1similarityscore,BLEU,orexactmatch,dependingon
whatisstandardforthedatasetathand.
Finalresultsarereportedonthetestsetwhenpubliclyavailable,foreachmodelsizeandlearningsetting(zero-,one-,
andfew-shot). Whenthetestsetisprivate,ourmodelisoftentoolargetofitonthetestserver,sowereportresultson
thedevelopmentset. Wedosubmittothetestserveronasmallnumberofdatasets(SuperGLUE,TriviaQA,PiQa)
wherewewereabletomakesubmissionwork,andwesubmitonlythe200Bfew-shotresults,andreportdevelopment
setresultsforeverythingelse.
3 Results
InFigure3.1wedisplaytrainingcurvesforthe8modelsdescribedinSection2. Forthisgraphwealsoinclude6
additionalextra-smallmodelswithasfewas100,000parameters. Asobservedin[KMH+20], languagemodeling
performancefollowsapower-lawwhenmakingefficientuseoftrainingcompute. Afterextendingthistrendbytwo
moreordersofmagnitude,weobserveonlyaslight(ifany)departurefromthepower-law. Onemightworrythatthese
improvementsincross-entropylosscomeonlyfrommodelingspuriousdetailsofourtrainingcorpus. However,wewill
seeinthefollowingsectionsthatimprovementsincross-entropylossleadtoconsistentperformancegainsacrossa
broadspectrumofnaturallanguagetasks.
Below,weevaluatethe8modelsdescribedinSection2(the175billionparameterparameterGPT-3and7smaller
models)onawiderangeofdatasets. Wegroupthedatasetsinto9categoriesrepresentingroughlysimilartasks.
InSection3.1weevaluateontraditionallanguagemodelingtasksandtasksthataresimilartolanguagemodeling,
suchasClozetasksandsentence/paragraphcompletiontasks. InSection3.2weevaluateon“closedbook”question
answering tasks: tasks which require using the information stored in the model’s parameters to answer general
knowledgequestions. InSection3.3weevaluatethemodel’sabilitytotranslatebetweenlanguages(especiallyone-shot
andfew-shot). InSection3.4weevaluatethemodel’sperformanceonWinogradSchema-liketasks. InSection3.5we
evaluateondatasetsthatinvolvecommonsensereasoningorquestionanswering. InSection3.6weevaluateonreading
comprehensiontasks,inSection3.7weevaluateontheSuperGLUEbenchmarksuite,andin3.8webrieflyexplore
NLI.Finally,inSection3.9,weinventsomeadditionaltasksdesignedespeciallytoprobein-contextlearningabilities–
thesetasksfocusonon-the-flyreasoning,adaptationskills,oropen-endedtextsynthesis. Weevaluatealltasksinthe
few-shot,one-shot,andzero-shotsettings.
10

Figure 3.1: Smooth scaling of performance with compute. Performance (measured in terms of cross-entropy
validationloss)followsapower-lawtrendwiththeamountofcomputeusedfortraining. Thepower-lawbehavior
observed in [KMH+20] continues for an additional two orders of magnitude with only small deviations from the
predictedcurve. Forthisfigure,weexcludeembeddingparametersfromcomputeandparametercounts.
Setting PTB
SOTA(Zero-Shot) 35.8a
GPT-3Zero-Shot 20.5
Table3.1: Zero-shotresultsonPTBlanguagemodelingdataset. Manyothercommonlanguagemodelingdatasets
areomittedbecausetheyarederivedfromWikipediaorothersourceswhichareincludedinGPT-3’strainingdata.
a[RWC+19]
3.1 LanguageModeling,Cloze,andCompletionTasks
In this section we test GPT-3’s performance on the traditional task of language modeling, as well as related tasks
thatinvolvepredictingasinglewordofinterest,completingasentenceorparagraph,orchoosingbetweenpossible
completionsofapieceoftext.
3.1.1 LanguageModeling
Wecalculatezero-shotperplexityonthePennTreeBank(PTB)[MKM+94]datasetmeasuredin[RWC+19]. Weomit
the4Wikipedia-relatedtasksinthatworkbecausetheyareentirelycontainedinourtrainingdata,andwealsoomitthe
one-billionwordbenchmarkduetoahighfractionofthedatasetbeingcontainedinourtrainingset. PTBescapesthese
issuesduetopredatingthemoderninternet. OurlargestmodelsetsanewSOTAonPTBbyasubstantialmarginof15
points,achievingaperplexityof20.50. NotethatsincePTBisatraditionallanguagemodelingdatasetitdoesnothave
aclearseparationofexamplestodefineone-shotorfew-shotevaluationaround,sowemeasureonlyzero-shot.
3.1.2 LAMBADA
The LAMBADA dataset [PKL+16] tests the modeling of long-range dependencies in text – the model is asked to
predictthelastwordofsentenceswhichrequirereadingaparagraphofcontext. Ithasrecentlybeensuggestedthatthe
continuedscalingoflanguagemodelsisyieldingdiminishingreturnsonthisdifficultbenchmark. [BHT+20]reflecton
thesmall1.5%improvementachievedbyadoublingofmodelsizebetweentworecentstateoftheartresults([SPP+19]
11

|         | LAMBADA | LAMBADA | StoryCloze | HellaSwag |
| ------- | ------- | ------- | ---------- | --------- |
| Setting | (acc)   | (ppl)   | (acc)      | (acc)     |
|         | 68.0a   | 8.63b   | 91.8c      | 85.6d     |
SOTA
| GPT-3Zero-Shot | 76.2 | 3.00 | 83.2 | 78.9 |
| -------------- | ---- | ---- | ---- | ---- |
| GPT-3One-Shot  | 72.5 | 3.35 | 84.7 | 78.1 |
| GPT-3Few-Shot  | 86.4 | 1.92 | 87.7 | 79.3 |
Table3.2: Performanceonclozeandcompletiontasks. GPT-3significantlyimprovesSOTAonLAMBADAwhile
achievingrespectableperformanceontwodifficultcompletionpredictiondatasets. a[Tur20]b[RWC+19]c[LDL19]
d[LCH+20]
Figure3.2: OnLAMBADA,thefew-shotcapabilityoflanguagemodelsresultsinastrongboosttoaccuracy. GPT-3
2.7BoutperformstheSOTA17BparameterTuring-NLG[Tur20]inthissetting,andGPT-3175Badvancesthestateof
theartby18%. Notezero-shotusesadifferentformatfromone-shotandfew-shotasdescribedinthetext.
and[Tur20])andarguethat“continuingtoexpandhardwareanddatasizesbyordersofmagnitudeisnotthepath
forward”. Wefindthatpathisstillpromisingandinazero-shotsettingGPT-3achieves76%onLAMBADA,againof
8%overthepreviousstateoftheart.
LAMBADAisalsoademonstrationoftheflexibilityoffew-shotlearningasitprovidesawaytoaddressaproblemthat
classicallyoccurswiththisdataset. AlthoughthecompletioninLAMBADAisalwaysthelastwordinasentence,a
standardlanguagemodelhasnowayofknowingthisdetail. Itthusassignsprobabilitynotonlytothecorrectendingbut
alsotoothervalidcontinuationsoftheparagraph. Thisproblemhasbeenpartiallyaddressedinthepastwithstop-word
filters[RWC+19](whichban“continuation”words).
Thefew-shotsettinginsteadallowsusto“frame”thetaskasa
cloze-testandallowsthelanguagemodeltoinferfromexamplesthatacompletionofexactlyonewordisdesired. We
usethefollowingfill-in-the-blankformat:
| AlicewasfriendswithBob.                             | Alicewenttovisitherfriend |     |     | . →Bob |
| --------------------------------------------------- | ------------------------- | --- | --- | ------ |
| Georgeboughtsomebaseballequipment,aball,aglove,anda |                           |     |     | . →    |
Whenpresentedwithexamplesformattedthisway,GPT-3achieves86.4%accuracyinthefew-shotsetting,anincrease
ofover18%fromthepreviousstate-of-the-art. Weobservethatfew-shotperformanceimprovesstronglywithmodel
size. Whilethissettingdecreasestheperformanceofthesmallestmodelbyalmost20%,forGPT-3itimprovesaccuracy
by10%. Finally,thefill-in-blankmethodisnoteffectiveone-shot,whereitalwaysperformsworsethanthezero-shot
setting. Perhapsthisisbecauseallmodelsstillrequireseveralexamplestorecognizethepattern.
12

Setting NaturalQS WebQS TriviaQA
RAG(Fine-tuned,Open-Domain)[LPP+20] 44.5 45.5 68.0
T5-11B+SSM(Fine-tuned,Closed-Book)[RRS20] 36.6 44.7 60.5
T5-11B(Fine-tuned,Closed-Book) 34.5 37.4 50.1
GPT-3Zero-Shot 14.6 14.4 64.3
GPT-3One-Shot 23.0 25.3 68.0
GPT-3Few-Shot 29.9 41.5 71.2
Table3.3: ResultsonthreeOpen-DomainQAtasks. GPT-3isshowninthefew-,one-,andzero-shotsettings,as
comparedtopriorSOTAresultsforclosedbookandopendomainsettings. TriviaQAfew-shotresultisevaluatedonthe
wikisplittestserver.
OnenoteofcautionisthatananalysisoftestsetcontaminationidentifiedthatasignificantminorityoftheLAMBADA
datasetappearstobepresentinourtrainingdata–howeveranalysisperformedinSection4suggestsnegligibleimpact
onperformance.
3.1.3 HellaSwag
TheHellaSwagdataset[ZHB+19]involvespickingthebestendingtoastoryorsetofinstructions. Theexampleswere
adversariallyminedtobedifficultforlanguagemodelswhileremainingeasyforhumans(whoachieve95.6%accuracy).
GPT-3achieves78.1%accuracyintheone-shotsettingand79.3%accuracyinthefew-shotsetting,outperformingthe
75.4%accuracyofafine-tuned1.5Bparameterlanguagemodel[ZHR+19]butstillafairamountlowerthantheoverall
SOTAof85.6%achievedbythefine-tunedmulti-taskmodelALUM.
3.1.4 StoryCloze
We next evaluate GPT-3 on the StoryCloze 2016 dataset [MCH+16], which involves selecting the correct ending
sentenceforfive-sentencelongstories. HereGPT-3achieves83.2%inthezero-shotsettingand87.7%inthefew-shot
setting(withK = 70). Thisisstill4.1%lowerthanthefine-tunedSOTAusingaBERTbasedmodel[LDL19]but
improvesoverpreviouszero-shotresultsbyroughly10%.
3.2 ClosedBookQuestionAnswering
InthissectionwemeasureGPT-3’sabilitytoanswerquestionsaboutbroadfactualknowledge. Duetotheimmense
amountofpossiblequeries,thistaskhasnormallybeenapproachedbyusinganinformationretrievalsystemtofind
relevanttextincombinationwithamodelwhichlearnstogenerateananswergiventhequestionandtheretrieved
text. Sincethissettingallowsasystemtosearchforandconditionontextwhichpotentiallycontainstheanswerit
isdenoted“open-book”. [RRS20]recentlydemonstratedthatalargelanguagemodelcanperformsurprisinglywell
directlyansweringthequestionswithoutconditioningonauxilliaryinformation. Theydenotethismorerestrictive
evaluationsettingas“closed-book”. Theirworksuggeststhatevenhigher-capacitymodelscouldperformevenbetter
andwetestthishypothesiswithGPT-3. WeevaluateGPT-3onthe3datasetsin[RRS20]:NaturalQuestions[KPR+19],
WebQuestions[BCFL13],andTriviaQA[JCWZ17],usingthesamesplits. Notethatinadditiontoallresultsbeingin
theclosed-booksetting,ouruseoffew-shot,one-shot,andzero-shotevaluationsrepresentanevenstrictersettingthan
previousclosed-bookQAwork: inadditiontoexternalcontentnotbeingallowed,fine-tuningontheQ&Adatasetitself
isalsonotpermitted.
TheresultsforGPT-3areshowninTable3.3. OnTriviaQA,weachieve64.3%inthezero-shotsetting,68.0%inthe
one-shotsetting,and71.2%inthefew-shotsetting. Thezero-shotresultalreadyoutperformsthefine-tunedT5-11Bby
14.2%,andalsooutperformsaversionwithQ&Atailoredspanpredictionduringpre-trainingby3.8%. Theone-shot
resultimprovesby3.7%andmatchestheSOTAforanopen-domainQAsystemwhichnotonlyfine-tunesbutalso
makesuseofalearnedretrievalmechanismovera15.3Bparameterdensevectorindexof21Mdocuments[LPP+20].
GPT-3’sfew-shotresultfurtherimprovesperformanceanother3.2%beyondthis.
OnWebQuestions(WebQs),GPT-3achieves14.4%inthezero-shotsetting,25.3%intheone-shotsetting,and41.5%
in the few-shot setting. This compares to 37.4% for fine-tuned T5-11B, and 44.7% for fine-tuned T5-11B+SSM,
which uses a Q&A-specific pre-training procedure. GPT-3 in the few-shot setting approaches the performance of
state-of-the-artfine-tunedmodels. Notably,comparedtoTriviaQA,WebQSshowsamuchlargergainfromzero-shotto
few-shot(andindeeditszero-shotandone-shotperformancearepoor),perhapssuggestingthattheWebQsquestions
13

Figure3.3: OnTriviaQAGPT3’sperformancegrowssmoothlywithmodelsize,suggestingthatlanguagemodels
continuetoabsorbknowledgeastheircapacityincreases. One-shotandfew-shotperformancemakesignificantgains
overzero-shotbehavior,matchingandexceedingtheperformanceoftheSOTAfine-tunedopen-domainmodel,RAG
[LPP+20]
and/orthestyleoftheiranswersareout-of-distributionforGPT-3. Nevertheless,GPT-3appearsabletoadapttothis
distribution,recoveringstrongperformanceinthefew-shotsetting.
OnNaturalQuestions(NQs)GPT-3achieves14.6%inthezero-shotsetting,23.0%intheone-shotsetting,and29.9%in
thefew-shotsetting,comparedto36.6%forfine-tunedT511B+SSM.SimilartoWebQS,thelargegainfromzero-shot
to few-shot may suggest a distribution shift, and may also explain the less competitive performance compared to
TriviaQAandWebQS.Inparticular,thequestionsinNQstendtowardsveryfine-grainedknowledgeonWikipedia
specificallywhichcouldbetestingthelimitsofGPT-3’scapacityandbroadpretrainingdistribution.
Overall,ononeofthethreedatasetsGPT-3’sone-shotmatchestheopen-domainfine-tuningSOTA.Ontheothertwo
datasetsitapproachestheperformanceoftheclosed-bookSOTAdespitenotusingfine-tuning. Onall3datasets,we
findthatperformancescalesverysmoothlywithmodelsize(Figure3.3andAppendixHFigureH.7),possiblyreflecting
theideathatmodelcapacitytranslatesdirectlytomore‘knowledge’absorbedintheparametersofthemodel.
3.3 Translation
ForGPT-2afilterwasusedonamultilingualcollectionofdocumentstoproduceanEnglishonlydatasetduetocapacity
concerns. EvenwiththisfilteringGPT-2showedsomeevidenceofmultilingualcapabilityandperformednon-trivially
whentranslatingbetweenFrenchandEnglishdespiteonlytrainingon10megabytesofremainingFrenchtext. Sincewe
increasethecapacitybyovertwoordersofmagnitudefromGPT-2toGPT-3,wealsoexpandthescopeofthetraining
datasettoincludemorerepresentationofotherlanguages,thoughthisremainsanareaforfurtherimprovement. As
discussedin2.2themajorityofourdataisderivedfromrawCommonCrawlwithonlyquality-basedfiltering. Although
GPT-3’strainingdataisstillprimarilyEnglish(93%bywordcount),italsoincludes7%oftextinotherlanguages.
Theselanguagesaredocumentedinthesupplementalmaterial. Inordertobetterunderstandtranslationcapability,we
alsoexpandouranalysistoincludetwoadditionalcommonlystudiedlanguages,GermanandRomanian.
Existingunsupervisedmachinetranslationapproachesoftencombinepretrainingonapairofmonolingualdatasets
withback-translation[SHB15]tobridgethetwolanguagesinacontrolledway. Bycontrast, GPT-3learnsfroma
blend of training data that mixes many languages together in a natural way, combining them on a word, sentence,
anddocumentlevel. GPT-3alsousesasingletrainingobjectivewhichisnotcustomizedordesignedforanytaskin
particular. However,ourone/few-shotsettingsaren’tstrictlycomparabletopriorunsupervisedworksincetheymake
useofasmallamountofpairedexamples(1or64). Thiscorrespondstouptoapageortwoofin-contexttrainingdata.
ResultsareshowninTable3.4. Zero-shotGPT-3,whichonlyreceivesonanaturallanguagedescriptionofthetask,
stillunderperformsrecentunsupervisedNMTresults. However,providingonlyasingleexampledemonstrationfor
14

|     |     |     | En→Fr Fr→En | En→De | De→En | En→Ro Ro→En |     |
| --- | --- | --- | ----------- | ----- | ----- | ----------- | --- |
Setting
|     | SOTA(Supervised) |     | 45.6a 35.0b | 41.2c     | 40.2d | 38.5e 39.9e |     |
| --- | ---------------- | --- | ----------- | --------- | ----- | ----------- | --- |
|     | XLM[LC19]        |     | 33.4        | 33.3 26.4 | 34.3  | 33.3 31.8   |     |
|     | MASS[STQ+19]     |     | 37.5        | 34.9 28.3 | 35.2  | 35.2 33.1   |     |
mBART[LGG+20]
|     |                |     | -    | - 29.8    | 34.0 | 35.0 30.5 |     |
| --- | -------------- | --- | ---- | --------- | ---- | --------- | --- |
|     | GPT-3Zero-Shot |     | 25.2 | 21.2 24.6 | 27.2 | 14.1 19.9 |     |
|     | GPT-3One-Shot  |     | 28.3 | 33.7 26.2 | 30.4 | 20.6 38.6 |     |
|     | GPT-3Few-Shot  |     | 32.6 | 39.2 29.7 | 40.6 | 21.0 39.5 |     |
Table 3.4: Few-shot GPT-3 outperforms previous unsupervised NMT work by 5 BLEU when translating
into English reflecting its strength as an English LM. We report BLEU scores on the WMT’14 Fr↔En,
WMT’16 De↔En, and WMT’16 Ro↔En datasets as measured by multi-bleu.perl with XLM’s tokeniza-
tion in order to compare most closely with prior unsupervised NMT work. SacreBLEUf [Pos18] results re-
ported in Appendix H. Underline indicates an unsupervised or few-shot SOTA, bold indicates supervised SOTA
|               |             | a[EOAG18] | b[DHKH14] | c[WXH+18] | d[oR16] | e[LGG+20] f[SacreBLEU |            |
| ------------- | ----------- | --------- | --------- | --------- | ------- | --------------------- | ---------- |
| with relative | confidence. |           |           |           |         |                       | signature: |
BLEU+case.mixed+numrefs.1+smooth.exp+tok.intl+version.1.2.20]
Figure3.4: Few-shottranslationperformanceon6languagepairsasmodelcapacityincreases. Thereisaconsistent
trendofimprovementacrossalldatasetsasthemodelscales,andaswellastendencyfortranslationintoEnglishtobe
strongerthantranslationfromEnglish.
15

Setting Winograd Winogrande(XL)
Fine-tunedSOTA 90.1a 84.6b
GPT-3Zero-Shot 88.3* 70.2
GPT-3One-Shot 89.7* 73.2
GPT-3Few-Shot 88.6* 77.7
Table3.5: ResultsontheWSC273versionofWinogradschemasandtheadversarialWinograndedataset. SeeSection
4fordetailsonpotentialcontaminationoftheWinogradtestset. a[SBBC19]b[LYN+20]
Figure3.5: Zero-,one-,andfew-shotperformanceontheadversarialWinograndedatasetasmodelcapacityscales.
Scalingisrelativelysmoothwiththegainstofew-shotlearningincreasingwithmodelsize,andfew-shotGPT-3175B
iscompetitivewithafine-tunedRoBERTA-large.
each translation task improves performance by over 7 BLEU and nears competitive performance with prior work.
GPT-3inthefullfew-shotsettingfurtherimprovesanother4BLEUresultinginsimilaraverageperformancetoprior
unsupervisedNMTwork. GPT-3hasanoticeableskewinitsperformancedependingonlanguagedirection. Forthe
threeinputlanguagesstudied,GPT-3significantlyoutperformspriorunsupervisedNMTworkwhentranslatinginto
Englishbutunderperformswhentranslatingintheotherdirection. PerformanceonEn-Roisanoticeableoutlierat
over10BLEUworsethanpriorunsupervisedNMTwork. Thiscouldbeaweaknessduetoreusingthebyte-levelBPE
tokenizerofGPT-2whichwasdevelopedforanalmostentirelyEnglishtrainingdataset. ForbothFr-EnandDe-En,
fewshotGPT-3outperformsthebestsupervisedresultwecouldfindbutduetoourunfamiliaritywiththeliteratureand
theappearancethattheseareun-competitivebenchmarkswedonotsuspectthoseresultsrepresenttruestateoftheart.
ForRo-En,fewshotGPT-3performswithin0.5BLEUoftheoverallSOTAwhichisachievedbyacombinationof
unsupervisedpretraining,supervisedfinetuningon608Klabeledexamples,andbacktranslation[LHCG19b].
Finally,acrossalllanguagepairsandacrossallthreesettings(zero-,one-,andfew-shot),thereisasmoothtrendof
improvementwithmodelcapacity. ThisisshowninFigure3.4inthecaseoffew-shotresults,andscalingforallthree
settingsisshowninAppendixH.
3.4 Winograd-StyleTasks
TheWinogradSchemasChallenge[LDM12]isaclassicaltaskinNLPthatinvolvesdeterminingwhichwordapronoun
refersto,whenthepronounisgrammaticallyambiguousbutsemanticallyunambiguoustoahuman. Recentlyfine-tuned
languagemodelshaveachievednear-humanperformanceontheoriginalWinograddataset,butmoredifficultversions
16

Setting PIQA ARC(Easy) ARC(Challenge) OpenBookQA
Fine-tunedSOTA 79.4 92.0[KKS+20] 78.5[KKS+20] 87.2[KKS+20]
GPT-3Zero-Shot 80.5* 68.8 51.4 57.6
GPT-3One-Shot 80.5* 71.2 53.2 58.8
GPT-3Few-Shot 82.8* 70.1 51.5 65.4
Table3.6: GPT-3resultsonthreecommonsensereasoningtasks,PIQA,ARC,andOpenBookQA.GPT-3Few-Shot
PIQAresultisevaluatedonthetestserver. SeeSection4fordetailsonpotentialcontaminationissuesonthePIQAtest
set.
Figure3.6: GPT-3resultsonPIQAinthezero-shot,one-shot,andfew-shotsettings. Thelargestmodelachievesa
scoreonthedevelopmentsetinallthreeconditionsthatexceedsthebestrecordedscoreonthetask.
suchastheadversarially-minedWinograndedataset[SBBC19]stillsignificantlylaghumanperformance. Wetest
GPT-3’sperformanceonbothWinogradandWinogrande,asusualinthezero-,one-,andfew-shotsetting.
OnWinogradwetestGPT-3ontheoriginalsetof273Winogradschemas,usingthesame“partialevaluation”method
describedin[RWC+19]. NotethatthissettingdiffersslightlyfromtheWSCtaskintheSuperGLUEbenchmark,which
ispresentedasbinaryclassificationandrequiresentityextractiontoconverttotheformdescribedinthissection. On
WinogradGPT-3achieves88.3%,89.7%,and88.6%inthezero-shot,one-shot,andfew-shotsettings,showingnoclear
in-contextlearningbutinallcasesachievingstrongresultsjustafewpointsbelowstate-of-the-artandestimatedhuman
performance. WenotethatcontaminationanalysisfoundsomeWinogradschemasinthetrainingdatabutthisappears
tohaveonlyasmalleffectonresults(seeSection4).
On the more difficult Winogrande dataset, we do find gains to in-context learning: GPT-3 achieves 70.2% in the
zero-shot setting, 73.2% in the one-shot setting, and 77.7% in the few-shot setting. For comparison a fine-tuned
RoBERTAmodelachieves79%,state-of-the-artis84.6%achievedwithafine-tunedhighcapacitymodel(T5),and
humanperformanceonthetaskasreportedby[SBBC19]is94.0%.
3.5 CommonSenseReasoning
Nextweconsiderthreedatasetswhichattempttocapturephysicalorscientificreasoning,asdistinctfromsentence
completion,readingcomprehension,orbroadknowledgequestionanswering. Thefirst,PhysicalQA(PIQA)[BZB+19],
askscommonsensequestionsabouthowthephysicalworldworksandisintendedasaprobeofgroundedunderstanding
of the world. GPT-3 achieves 81.0% accuracy zero-shot, 80.5% accuracy one-shot, and 82.8% accuracy few-shot
(thelastmeasuredonPIQA’stestserver). Thiscomparesfavorablytothe79.4%accuracypriorstate-of-the-artofa
17

Setting CoQA DROP QuAC SQuADv2 RACE-h RACE-m
Fine-tunedSOTA 90.7a 89.1b 74.4c 93.0d 90.0e 93.1e
GPT-3Zero-Shot 81.5 23.6 41.5 59.5 45.5 58.4
GPT-3One-Shot 84.0 34.3 43.3 65.4 45.9 57.4
GPT-3Few-Shot 85.0 36.5 44.3 69.8 46.8 58.1
Table3.7: Resultsonreadingcomprehensiontasks. AllscoresareF1exceptresultsforRACEwhichreportaccuracy.
a[JZC+19]b[JN20]c[AI19]d[QIA20]e[SPP+19]
fine-tunedRoBERTa. PIQAshowsrelativelyshallowscalingwithmodelsizeandisstillover10%worsethanhuman
performance, butGPT-3’sfew-shotandevenzero-shotresultoutperformthecurrentstate-of-the-art. Ouranalysis
flaggedPIQAforapotentialdatacontaminationissue(despitehiddentestlabels),andwethereforeconservativelymark
theresultwithanasterisk. SeeSection4fordetails.
ARC [CCE+18] is a dataset of multiple-choice questions collected from 3rd to 9th grade science exams. On the
“Challenge”versionofthedatasetwhichhasbeenfilteredtoquestionswhichsimplestatisticalorinformationretrieval
methodsareunabletocorrectlyanswer,GPT-3achieves51.4%accuracyinthezero-shotsetting,53.2%intheone-shot
setting,and51.5%inthefew-shotsetting. Thisisapproachingtheperformanceofafine-tunedRoBERTabaseline
(55.9%)fromUnifiedQA[KKS+20]. Onthe“Easy”versionofthedataset(questionswhicheitherofthementioned
baselineapproachesansweredcorrectly),GPT-3achieves68.8%,71.2%,and70.1%whichslightlyexceedsafine-tuned
RoBERTa baseline from [KKS+20]. However, both of these results are still much worse than the overall SOTAs
achievedbytheUnifiedQAwhichexceedsGPT-3’sfew-shotresultsby27%onthechallengesetand22%ontheeasy
set.
OnOpenBookQA[MCKS18],GPT-3improvessignificantlyfromzerotofewshotsettingsbutisstillover20points
short of the overall SOTA. GPT-3’s few-shot performance is similar to a fine-tuned BERT Large baseline on the
leaderboard.
Overall,in-contextlearningwithGPT-3showsmixedresultsoncommonsensereasoningtasks,withonlysmalland
inconsistent gains observed in the one and few-shot learning settings for both PIQA and ARC, but a significant
improvementisobservedonOpenBookQA.GPT-3setsSOTAonthenewPIQAdatasetinallevaluationsettings.
3.6 ReadingComprehension
NextweevaluateGPT-3onthetaskofreadingcomprehension. Weuseasuiteof5datasetsincludingabstractive,
multiplechoice,andspanbasedanswerformatsinbothdialogandsinglequestionsettings. Weobserveawidespread
inGPT-3’sperformanceacrossthesedatasetssuggestiveofvaryingcapabilitywithdifferentanswerformats. Ingeneral
weobserveGPT-3isonparwithinitialbaselinesandearlyresultstrainedusingcontextualrepresentationsoneach
respectivedataset.
GPT-3performsbest(within3pointsofthehumanbaseline)onCoQA[RCM19]afree-formconversationaldataset
andperformsworst(13F1belowanELMobaseline)onQuAC[CHI+18]adatasetwhichrequiresmodelingstructured
dialogactsandanswerspanselectionsofteacher-studentinteractions. OnDROP[DWD+19],adatasettestingdiscrete
reasoningandnumeracyinthecontextofreadingcomprehension,GPT-3inafew-shotsettingoutperformsthefine-tuned
BERTbaselinefromtheoriginalpaperbutisstillwellbelowbothhumanperformanceandstate-of-the-artapproaches
whichaugmentneuralnetworkswithsymbolicsystems[RLL+19]. OnSQuAD2.0[RJL18],GPT-3demonstratesits
few-shotlearningcapabilities,improvingbyalmost10F1(to69.8)comparedtoazero-shotsetting. Thisallowsitto
slightlyoutperformthebestfine-tunedresultintheoriginalpaper. OnRACE[LXL+17],amultiplechoicedatasetof
middleschoolandhighschoolenglishexaminations,GPT-3performsrelativelyweaklyandisonlycompetitivewith
theearliestworkutilizingcontextualrepresentationsandisstill45%behindSOTA.
3.7 SuperGLUE
InordertobetteraggregateresultsonNLPtasksandcomparetopopularmodelssuchasBERTandRoBERTaina
moresystematicway,wealsoevaluateGPT-3onastandardizedcollectionofdatasets,theSuperGLUEbenchmark
[WPN+19] [WPN+19] [CLC+19] [DMST19] [RBG11] [KCR+18] [ZLL+18] [DGM06] [BHDD+06] [GMDD07]
[BDD+09][PCC18][PHR+18]. GPT-3’stest-setperformanceontheSuperGLUEdatasetisshowninTable3.8. Inthe
few-shotsetting,weused32examplesforalltasks,sampledrandomlyfromthetrainingset. ForalltasksexceptWSC
18

Figure3.7: GPT-3resultsonCoQAreadingcomprehensiontask. GPT-3175Bachieves85F1inthefew-shotsetting,
onlyafewpointsbehindmeasuredhumanperformanceandstate-of-the-artfine-tunedmodels. Zero-shotandone-shot
performanceisafewpointsbehind,withthegainstofew-shotbeinglargestforbiggermodels.
|                      | SuperGLUE | BoolQ    | CB       | CB      | COPA     | RTE      |
| -------------------- | --------- | -------- | -------- | ------- | -------- | -------- |
|                      | Average   | Accuracy | Accuracy | F1      | Accuracy | Accuracy |
| Fine-tunedSOTA       | 89.0      | 91.0     | 96.9     | 93.9    | 94.8     | 92.5     |
| Fine-tunedBERT-Large | 69.0      | 77.4     | 83.6     | 75.7    | 70.6     | 71.7     |
| GPT-3Few-Shot        | 71.8      | 76.4     | 75.6     | 52.0    | 92.0     | 69.0     |
|                      | WiC       | WSC      | MultiRC  | MultiRC | ReCoRD   | ReCoRD   |
|                      | Accuracy  | Accuracy | Accuracy | F1a     | Accuracy | F1       |
| Fine-tunedSOTA       | 76.1      | 93.8     | 62.3     | 88.2    | 92.5     | 93.3     |
| Fine-tunedBERT-Large | 69.6      | 64.6     | 24.1     | 70.0    | 71.3     | 72.0     |
| GPT-3Few-Shot        | 49.4      | 80.1     | 30.5     | 75.4    | 90.2     | 91.1     |
Table3.8: PerformanceofGPT-3onSuperGLUEcomparedtofine-tunedbaselinesandSOTA.Allresultsarereported
onthetestset. GPT-3few-shotisgivenatotalof32exampleswithinthecontextofeachtaskandperformsnogradient
updates.
19

Figure3.8: PerformanceonSuperGLUEincreaseswithmodelsizeandnumberofexamplesincontext.Avalue
ofK =32meansthatourmodelwasshown32examplespertask,for256examplestotaldividedacrossthe8tasksin
SuperGLUE.WereportGPT-3valuesonthedevset,soournumbersarenotdirectlycomparabletothedottedreference
lines(ourtestsetresultsareinTable3.8). TheBERT-Largereferencemodelwasfine-tunedontheSuperGLUEtraining
set(125Kexamples),whereasBERT++wasfirstfine-tunedonMultiNLI(392Kexamples)andSWAG(113Kexamples)
before further fine-tuning on the SuperGLUE training set (for a total of 630K fine-tuning examples). We find the
differenceinperformancebetweentheBERT-LargeandBERT++toberoughlyequivalenttothedifferencebetween
GPT-3withoneexamplepercontextversuseightexamplespercontext.
andMultiRC,wesampledanewsetofexamplestouseinthecontextforeachproblem. ForWSCandMultiRC,we
usedthesamesetofrandomlydrawnexamplesfromthetrainingsetascontextforalloftheproblemsweevaluated.
WeobserveawiderangeinGPT-3’sperformanceacrosstasks. OnCOPAandReCoRDGPT-3achievesnear-SOTA
performance in the one-shot and few-shot settings, with COPA falling only a couple points short and achieving
secondplaceontheleaderboard,wherefirstplaceisheldbyafine-tuned11billionparametermodel(T5). OnWSC,
performanceisstillrelativelystrong,achieving80.1%inthefew-shotsetting(notethatGPT-3achieves88.6%onthe
originalWinograddatasetasdescribedinSection3.4). OnBoolQ,MultiRC,andRTE,performanceisreasonable,
roughlymatchingthatofafine-tunedBERT-Large. OnCB,weseesignsoflifeat75.6%inthefew-shotsetting.
WiCisanotableweakspotwithfew-shotperformanceat49.4%(atrandomchance). Wetriedanumberofdifferent
phrasingsandformulationsforWiC(whichinvolvesdeterminingifawordisbeingusedwiththesamemeaningintwo
sentences),noneofwhichwasabletoachievestrongperformance. Thishintsataphenomenonthatwillbecomeclearer
inthenextsection(whichdiscussestheANLIbenchmark)–GPT-3appearstobeweakinthefew-shotorone-shot
settingatsometasksthatinvolvecomparingtwosentencesorsnippets,forexamplewhetherawordisusedthesame
wayintwosentences(WiC),whetheronesentenceisaparaphraseofanother,orwhetheronesentenceimpliesanother.
ThiscouldalsoexplainthecomparativelylowscoresforRTEandCB,whichalsofollowthisformat. Despitethese
weaknesses,GPT-3stilloutperformsafine-tunedBERT-largeonfourofeighttasksandontwotasksGPT-3iscloseto
thestate-of-the-artheldbyafine-tuned11billionparametermodel.
Finally, we note that the few-shot SuperGLUE score steadily improves with both model size and with number of
examples in the context showing increasing benefits from in-context learning (Figure 3.8). We scale K up to 32
examplespertask,afterwhichpointadditionalexampleswillnotreliablyfitintoourcontext. Whensweepingover
valuesofK,wefindthatGPT-3requireslessthaneighttotalexamplespertasktooutperformafine-tunedBERT-Large
onoverallSuperGLUEscore.
3.8 NLI
NaturalLanguageInference(NLI)[Fyo00]concernstheabilitytounderstandtherelationshipbetweentwosentences.
Inpractice, thistaskisusuallystructuredasatwoorthreeclassclassificationproblemwherethemodelclassifies
20

Figure3.9: PerformanceofGPT-3onANLIRound3. Resultsareonthedev-set,whichhasonly1500examples
andthereforehashighvariance(weestimateastandarddeviationof1.2%). Wefindthatsmallermodelshoveraround
randomchance,whilefew-shotGPT-3175BclosesalmosthalfthegapfromrandomchancetoSOTA.Resultsfor
ANLIrounds1and2areshownintheappendix.
whetherthesecondsentencelogicallyfollowsfromthefirst,contradictsthefirstsentence,orispossiblytrue(neutral).
SuperGLUEincludesanNLIdataset,RTE,whichevaluatesthebinaryversionofthetask. OnRTE,onlythelargest
versionofGPT-3performsconvincinglybetterthanrandom(56%)inanyevaluationsetting,butinafew-shotsetting
GPT-3 performs similarly to a single-task fine-tuned BERT Large. We also evaluate on the recently introduced
AdversarialNaturalLanguageInference(ANLI)dataset[NWD+19]. ANLIisadifficultdatasetemployingaseriesof
adversariallyminednaturallanguageinferencequestionsinthreerounds(R1,R2,andR3). SimilartoRTE,allofour
modelssmallerthanGPT-3performatalmostexactlyrandomchanceonANLI,eveninthefew-shotsetting(∼33%),
whereasGPT-3itselfshowssignsoflifeonRound3. ResultsforANLIR3arehighlightedinFigure3.9andfullresults
forallroundscanbefoundinAppendixH.TheseresultsonbothRTEandANLIsuggestthatNLIisstillaverydifficult
taskforlanguagemodelsandtheyareonlyjustbeginningtoshowsignsofprogress.
3.9 SyntheticandQualitativeTasks
OnewaytoprobeGPT-3’srangeofabilitiesinthefew-shot(orzero-andone-shot)settingistogiveittaskswhich
require it to perform simple on-the-fly computational reasoning, recognize a novel pattern that is unlikely to have
occurredintraining,oradaptquicklytoanunusualtask. Wedeviseseveraltaskstotestthisclassofabilities. First,we
testGPT-3’sabilitytoperformarithmetic. Second,wecreateseveraltasksthatinvolverearrangingorunscramblingthe
lettersinaword,taskswhichareunlikelytohavebeenexactlyseenduringtraining. Third,wetestGPT-3’sabilityto
solveSAT-styleanalogyproblemsfew-shot. Finally,wetestGPT-3onseveralqualitativetasks,includingusingnew
wordsinasentence,correctingEnglishgrammar,andnewsarticlegeneration. Wewillreleasethesyntheticdatasets
withthehopeofstimulatingfurtherstudyoftest-timebehavioroflanguagemodels.
3.9.1 Arithmetic
TotestGPT-3’sabilitytoperformsimplearithmeticoperationswithouttask-specifictraining,wedevelopedasmall
batteryof10teststhatinvolveaskingGPT-3asimplearithmeticprobleminnaturallanguage:
• 2digitaddition(2D+)–Themodelisaskedtoaddtwointegerssampleduniformlyfrom[0,100),phrasedin
theformofaquestion,e.g. “Q:Whatis48plus76? A:124.”
• 2digitsubtraction(2D-)–Themodelisaskedtosubtracttwointegerssampleduniformlyfrom[0,100);the
answermaybenegative. Example: “Q:Whatis34minus53? A:-19”.
• 3digitaddition(3D+)–Sameas2digitaddition,exceptnumbersareuniformlysampledfrom[0,1000).
21

Figure 3.10: Results on all 10 arithmetic tasks in the few-shot settings for models of different sizes. There is a
significantjumpfromthesecondlargestmodel(GPT-313B)tothelargestmodel(GPT-3175),withthelatterbeing
abletoreliablyaccurate2digitarithmetic,usuallyaccurate3digitarithmetic,andcorrectanswersasignificantfraction
ofthetimeon4-5digitarithmetic,2digitmultiplication,andcompoundoperations. Resultsforone-shotandzero-shot
areshownintheappendix.
• 3digitsubtraction(3D-)–Sameas2digitsubtraction,exceptnumbersareuniformlysampledfrom[0,1000).
• 4digitaddition(4D+)–Sameas3digitaddition,exceptuniformlysampledfrom[0,10000).
• 4digitsubtraction(4D-)–Sameas3digitsubtraction,exceptuniformlysampledfrom[0,10000).
• 5digitaddition(5D+)–Sameas3digitaddition,exceptuniformlysampledfrom[0,100000).
• 5digitsubtraction(5D-)–Sameas3digitsubtraction,exceptuniformlysampledfrom[0,100000).
• 2digitmultiplication(2Dx)–Themodelisaskedtomultiplytwointegerssampleduniformlyfrom[0,100),
e.g. “Q:Whatis24times42? A:1008”.
• One-digitcomposite(1DC)–Themodelisaskedtoperformacompositeoperationonthree1digitnumbers,
withparenthesesaroundthelasttwo. Forexample,“Q:Whatis6+(4*8)? A:38”. Thethree1digitnumbers
areselecteduniformlyon[0,10)andtheoperationsareselecteduniformlyfrom{+,-,*}.
Inall10tasksthemodelmustgeneratethecorrectanswerexactly. Foreachtaskwegenerateadatasetof2,000random
instancesofthetaskandevaluateallmodelsonthoseinstances.
FirstweevaluateGPT-3inthefew-shotsetting,forwhichresultsareshowninFigure3.10. Onadditionandsubtraction,
GPT-3displaysstrongproficiencywhenthenumberofdigitsissmall,achieving100%accuracyon2digitaddition,
98.9%at2digitsubtraction,80.2%at3digitaddition,and94.2%at3-digitsubtraction. Performancedecreasesasthe
numberofdigitsincreases,butGPT-3stillachieves25-26%accuracyonfourdigitoperationsand9-10%accuracyon
fivedigitoperations,suggestingatleastsomecapacitytogeneralizetolargernumbersofdigits. GPT-3alsoachieves
29.2%accuracyat2digitmultiplication,anespeciallycomputationallyintensiveoperation. Finally,GPT-3achieves
21.3%accuracyatsingledigitcombinedoperations(forexample,9*(7+5)),suggestingthatithassomerobustness
beyondjustsingleoperations.
AsFigure3.10makesclear,smallmodelsdopoorlyonallofthesetasks–eventhe13billionparametermodel(the
secondlargestafterthe175billionfullGPT-3)cansolve2digitadditionandsubtractiononlyhalfthetime,andall
otheroperationslessthan10%ofthetime.
One-shotandzero-shotperformancearesomewhatdegradedrelativetofew-shotperformance,suggestingthatadaptation
to the task (or at the very least recognition of the task) is important to performing these computations correctly.
Nevertheless,one-shotperformanceisstillquitestrong,andevenzero-shotperformanceofthefullGPT-3significantly
22

Setting 2D+ 2D- 3D+ 3D- 4D+ 4D- 5D+ 5D- 2Dx 1DC
GPT-3Zero-shot 76.9 58.0 34.2 48.3 4.0 7.5 0.7 0.8 19.8 9.8
GPT-3One-shot 99.6 86.4 65.5 78.7 14.0 14.0 3.5 3.8 27.4 14.3
GPT-3Few-shot 100.0 98.9 80.4 94.2 25.5 26.8 9.3 9.9 29.2 21.3
Table 3.9: Results on basic arithmetic tasks for GPT-3 175B. {2,3,4,5}D{+,-} is 2, 3, 4, and 5 digit addition or
subtraction,2Dxis2digitmultiplication. 1DCis1digitcompositeoperations. Resultsbecomeprogressivelystronger
movingfromthezero-shottoone-shottofew-shotsetting,buteventhezero-shotshowssignificantarithmeticabilities.
Setting CL A1 A2 RI RW
GPT-3Zero-shot 3.66 2.28 8.91 8.26 0.09
GPT-3One-shot 21.7 8.62 25.9 45.4 0.48
GPT-3Few-shot 37.9 15.1 39.7 67.2 0.44
Table3.10: GPT-3175Bperformanceonvariouswordunscramblingandwordmanipulationtasks,inzero-,one-,and
few-shotsettings. CLis“cyclelettersinword”,A1isanagramsofbutthefirstandlastletters,A2isanagramsofallbut
thefirstandlasttwoletters,RIis“Randominsertioninword”,RWis“reversedwords”.
outperformsfew-shotlearningforallsmallermodels. AllthreesettingsforthefullGPT-3areshowninTable3.9,and
modelcapacityscalingforallthreesettingsisshowninAppendixH.
Tospot-checkwhetherthemodelissimplymemorizingspecificarithmeticproblems,wetookthe3-digitarithmetic
problems in our test set and searched for them in our training data in both the forms "<NUM1> + <NUM2> =" and
"<NUM1> plus <NUM2>". Out of 2,000 addition problems we found only 17 matches (0.8%) and out of 2,000
subtractionproblemswefoundonly2matches(0.1%),suggestingthatonlyatrivialfractionofthecorrectanswers
couldhavebeenmemorized. Inaddition,inspectionofincorrectanswersrevealsthatthemodeloftenmakesmistakes
such as not carrying a “1”, suggesting it is actually attempting to perform the relevant computation rather than
memorizingatable.
Overall, GPT-3 displays reasonable proficiency at moderately complex arithmetic in few-shot, one-shot, and even
zero-shotsettings.
3.9.2 WordScramblingandManipulationTasks
TotestGPT-3’sabilitytolearnnovelsymbolicmanipulationsfromafewexamples,wedesignedasmallbatteryof
5 “character manipulation” tasks. Each task involves giving the model a word distorted by some combination of
scrambling,addition,ordeletionofcharacters,andaskingittorecovertheoriginalword. The5tasksare:
• Cyclelettersinword(CL)–Themodelisgivenawordwithitsletterscycled,thenthe“=”symbol,and
is expected to generate the original word. For example, it might be given “lyinevitab” and should output
“inevitably”.
• Anagramsofallbutfirstandlastcharacters(A1)–Themodelisgivenawordwhereeveryletterexcept
thefirstandlasthavebeenscrambledrandomly,andmustoutputtheoriginalword. Example: criroptuon=
corruption.
• Anagramsofallbutfirstandlast2characters(A2)–Themodelisgivenawordwhereeveryletterexcept
thefirst2andlast2havebeenscrambledrandomly,andmustrecovertheoriginalword. Example: opoepnnt
→opponent.
• Randominsertioninword(RI)–Arandompunctuationorspacecharacterisinsertedbetweeneachletter
ofaword,andthemodelmustoutputtheoriginalword. Example: s.u!c/c!e.ssi/o/n=succession.
• Reversedwords(RW)–Themodelisgivenawordspelledbackwards,andmustoutputtheoriginalword.
Example: stcejbo→objects.
Foreachtaskwegenerate10,000examples,whichwechosetobethetop10,000mostfrequentwordsasmeasuredby
[Nor09]oflengthmorethan4charactersandlessthan15characters. Thefew-shotresultsareshowninFigure3.11.
Taskperformancetendstogrowsmoothlywithmodelsize,withthefullGPT-3modelachieving66.9%onremoving
23

Figure3.11: Few-shotperformanceonthefivewordscramblingtasksfordifferentsizesofmodel. Thereisgenerally
smoothimprovementwithmodelsizealthoughtherandominsertiontaskshowsanupwardslopeofimprovementwith
the175Bmodelsolvingthetaskthemajorityofthetime. Scalingofone-shotandzero-shotperformanceisshownin
theappendix. AlltasksaredonewithK =100.
randominsertions,38.6%oncyclingletters,40.2%ontheeasieranagramtask,and15.1%onthemoredifficultanagram
task(whereonlythefirstandlastlettersareheldfixed). Noneofthemodelscanreversethelettersinaword.
Intheone-shotsetting,performanceissignificantlyweaker(droppingbyhalformore),andinthezero-shotsettingthe
modelcanrarelyperformanyofthetasks(Table3.10). Thissuggeststhatthemodelreallydoesappeartolearnthese
tasksattesttime,asthemodelcannotperformthemzero-shotandtheirartificialnaturemakesthemunlikelytoappear
inthepre-trainingdata(althoughwecannotconfirmthiswithcertainty).
We can further quantify performance by plotting “in-context learning curves”, which show task performance as a
functionofthenumberofin-contextexamples. Weshowin-contextlearningcurvesfortheSymbolInsertiontask
inFigure1.2. Wecanseethatlargermodelsareabletomakeincreasinglyeffectiveuseofin-contextinformation,
includingbothtaskexamplesandnaturallanguagetaskdescriptions.
Finally,itisworthaddingthatsolvingthesetasksrequirescharacter-levelmanipulations,whereasourBPEencoding
operatesonsignificantfractionsofaword(onaverage∼0.7wordspertoken),sofromtheLM’sperspectivesucceeding
atthesetasksinvolvesnotjustmanipulatingBPEtokensbutunderstandingandpullingaparttheirsubstructure. Also,
CL,A1,andA2arenotbijective(thatis,theunscrambledwordisnotadeterministicfunctionofthescrambledword),
requiringthemodeltoperformsomesearchtofindthecorrectunscrambling. Thus,theskillsinvolvedappeartorequire
non-trivialpattern-matchingandcomputation.
3.9.3 SATAnalogies
TotestGPT-3onanothertaskthatissomewhatunusualrelativetothetypicaldistributionoftext,wecollectedasetof
374“SATanalogy”problems[TLBS03]. Analogiesareastyleofmultiplechoicequestionthatconstitutedasectionof
theSATcollegeentranceexambefore2005. Atypicalexampleis“audaciousistoboldnessas(a)sanctimoniousisto
hypocrisy,(b)anonymousistoidentity,(c)remorsefulistomisdeed,(d)deleteriousistoresult,(e)impressionableisto
temptation”. Thestudentisexpectedtochoosewhichofthefivewordpairshasthesamerelationshipastheoriginal
wordpair;inthisexampletheansweris“sanctimoniousistohypocrisy”. OnthistaskGPT-3achieves65.2%inthe
few-shotsetting,59.1%intheone-shotsetting,and53.7%inthezero-shotsetting,whereastheaveragescoreamong
collegeapplicantswas57%[TL05](randomguessingyields20%). AsshowninFigure3.12,theresultsimprovewith
scale,withthethefull175billionmodelimprovingbyover10%comparedtothe13billionparametermodel.
24

Figure3.12: Zero-,one-,andfew-shotperformanceonSATanalogytasks,fordifferentsizesofmodel. Thelargest
modelachieves65%accuracyinthefew-shotsetting,andalsodemonstratessignificantgainstoin-contextlearning
whicharenotpresentinsmallermodels.
3.9.4 NewsArticleGeneration
Previousworkongenerativelanguagemodelsqualitativelytestedtheirabilitytogeneratesynthetic“newsarticles”by
conditionalsamplingfromthemodelgivenahuman-writtenpromptconsistingofaplausiblefirstsentenceforanews
story[RWC+19]. Relativeto[RWC+19],thedatasetusedtotrainGPT-3ismuchlessweightedtowardsnewsarticles,
sotryingtogeneratenewsarticlesviarawunconditionalsamplesislesseffective–forexampleGPT-3ofteninterprets
theproposedfirstsentenceofa“newsarticle”asatweetandthenpostssyntheticresponsesorfollow-uptweets. To
solvethisproblemweemployedGPT-3’sfew-shotlearningabilitiesbyprovidingthreepreviousnewsarticlesinthe
model’s context to condition it. With the title and subtitle of a proposed next article, the model is able to reliably
generateshortarticlesinthe“news”genre.
TogaugethequalityofnewsarticlegenerationfromGPT-3(whichwebelieveislikelytobecorrelatedwithconditional
samplegenerationqualityingeneral),wedecidedtomeasurehumanabilitytodistinguishGPT-3-generatedarticles
fromrealones. SimilarworkhasbeencarriedoutbyKrepsetal. [KMB20]andZellersetal. [ZHR+19]. Generative
languagemodelsaretrainedtomatchthedistributionofcontentgeneratedbyhumans,sothe(in)abilityofhumansto
distinguishthetwoisapotentiallyimportantmeasureofquality.3
Inordertoseehowwellhumanscandetectmodelgeneratedtext,wearbitrarilyselected25articletitlesandsubtitles
fromthewebsitenewser.com(meanlength: 215words). Wethengeneratedcompletionsofthesetitlesandsubtitles
fromfourlanguagemodelsranginginsizefrom125Mto175B(GPT-3)parameters(meanlength: 200words). Foreach
model,wepresentedaround80US-basedparticipantswithaquizconsistingoftheserealtitlesandsubtitlesfollowed
byeitherthehumanwrittenarticleorthearticlegeneratedbythemodel4. Participantswereaskedtoselectwhetherthe
articlewas“verylikelywrittenbyahuman”,“morelikelywrittenbyahuman”,“Idon’tknow”,“morelikelywrittenby
amachine”,or“verylikelywrittenbyamachine”.
The articles we selected were not in the models’ training data and the model outputs were formatted and selected
programmaticallytopreventhumancherry-picking. Allmodelsusedthesamecontexttoconditionoutputsonandwere
pre-trainedwiththesamecontextsizeandthesamearticletitlesandsubtitleswereusedaspromptsforeachmodel.
However,wealsorananexperimenttocontrolforparticipanteffortandattentionthatfollowedthesameformatbut
involvedintentionallybadmodelgeneratedarticles. Thiswasdonebygeneratingarticlesfroma“controlmodel”: a
160Mparametermodelwithnocontextandincreasedoutputrandomness.
3ThistaskisalsorelevanttothepotentialmisuseoflanguagemodelsdiscussedinSection6.1.
4Wewantedtoidentifyhowgoodanaveragepersonontheinternetisatdetectinglanguagemodeloutputs,sowefocusedon
participantsdrawnfromthegeneralUSpopulation.SeeAppendixEfordetails.
25

|                               |              | 95%Confidence    | tcomparedto      | “Idon’tknow” |
| ----------------------------- | ------------ | ---------------- | ---------------- | ------------ |
|                               | Meanaccuracy | Interval(low,hi) | control(p-value) | assignments  |
| Control(deliberatelybadmodel) | 86%          | 83%–90%          | -                | 3.6%         |
| GPT-3Small                    | 76%          | 72%–80%          | 3.9(2e-4)        | 4.9%         |
| GPT-3Medium                   | 61%          | 58%–65%          | 10.3(7e-21)      | 6.0%         |
| GPT-3Large                    | 68%          | 64%–72%          | 7.3(3e-11)       | 8.7%         |
| GPT-3XL                       | 62%          | 59%–65%          | 10.7(1e-19)      | 7.5%         |
| GPT-32.7B                     | 62%          | 58%–65%          | 10.4(5e-19)      | 7.1%         |
| GPT-36.7B                     | 60%          | 56%–63%          | 11.2(3e-21)      | 6.2%         |
| GPT-313B                      | 55%          | 52%–58%          | 15.3(1e-32)      | 7.1%         |
| GPT-3175B                     | 52%          | 49%–54%          | 16.9(1e-34)      | 7.8%         |
Table3.11: Humanaccuracyinidentifyingwhethershort(∼200word)newsarticlesaremodelgenerated. We
findthathumanaccuracy(measuredbytheratioofcorrectassignmentstonon-neutralassignments)rangesfrom86%
onthecontrolmodelto52%onGPT-3175B.Thistablecomparesmeanaccuracybetweenfivedifferentmodels,and
showstheresultsofatwo-sampleT-Testforthedifferenceinmeanaccuracybetweeneachmodelandthecontrolmodel
(anunconditionalGPT-3Smallmodelwithincreasedoutputrandomness).
Meanhumanaccuracy(theratioofcorrectassignmentstonon-neutralassignmentsperparticipant)atdetectingthat
theintentionallybadarticlesweremodelgeneratedwas∼86% where50%ischancelevelperformance. Bycontrast,
meanhumanaccuracyatdetectingarticlesthatwereproducedbythe175Bparametermodelwasbarelyabovechance
at∼52%(seeTable3.11).5 Humanabilitiestodetectmodelgeneratedtextappeartodecreaseasmodelsizeincreases:
thereappearstobeatrendtowardschanceaccuracywithmodelsize,andhumandetectionofGPT-3isclosetochance.6
Thisistruedespitethefactthatparticipantsspendmoretimeoneachoutputasmodelsizeincreases(seeAppendixE).
ExamplesofsyntheticarticlesfromGPT-3aregiveninFigures3.14and3.15.7 Muchofthetextis—asindicatedbythe
evaluations—difficultforhumanstodistinguishfromauthentichumancontent. Factualinaccuraciescanbeanindicator
thatanarticleismodelgeneratedsince,unlikehumanauthors,themodelshavenoaccesstothespecificfactsthatthe
articletitlesrefertoorwhenthearticlewaswritten. Otherindicatorsincluderepetition,nonsequiturs,andunusual
phrasings,thoughtheseareoftensubtleenoughthattheyarenotnoticed.
RelatedworkonlanguagemodeldetectionbyIppolitoetal. [IDCBE19]indicatesthatautomaticdiscriminatorslike
GROVER [ZHR+19]andGLTR[GSR19]mayhavegreatersuccessatdetectingmodelgeneratedtextthanhuman
evaluators. Automaticdetectionofthesemodelsmaybeapromisingareaoffutureresearch.
Ippolitoetal. [IDCBE19]alsonotethathumanaccuracyatdetectingmodelgeneratedtextincreasesashumansobserve
moretokens. Todoapreliminaryinvestigationofhowgoodhumansareatdetectinglongernewsarticlesgenerated
byGPT-3175B,weselected12worldnewsarticlesfromReuterswithanaveragelengthof569wordsandgenerated
completions of these articles from GPT-3 with an average length of 498 words (298 words longer than our initial
experiments). Followingthemethodologyabove,werantwoexperiments,eachonaround80US-basedparticipants,to
comparehumanabilitiestodetectthearticlesgeneratedbyGPT-3andacontrolmodel.
Wefoundthatmeanhumanaccuracyatdetectingtheintentionallybadlongerarticlesfromthecontrolmodelwas
∼88%,whilemeanhumanaccuracyatdetectingthelongerarticlesthatwereproducedbyGPT-3175Bwasstillbarely
abovechanceat∼52%(seeTable3.12). Thisindicatesthat,fornewsarticlesthatarearound500wordslong,GPT-3
continuestoproducearticlesthathumansfinddifficulttodistinguishfromhumanwrittennewsarticles.
3.9.5 LearningandUsingNovelWords
Ataskstudiedindevelopmentallinguistics[CB78]istheabilitytolearnandutilizenewwords,forexampleusinga
wordinasentenceafterseeingitdefinedonlyonce,orconverselyinferringaword’smeaningfromonlyoneusage.Here
wequalitativelytestGPT-3’sabilitytodotheformer. Specifically,wegiveGPT-3thedefinitionofanonexistentword,
suchas“Gigamuru”,andthenaskittouseitinasentence. Weprovideonetofivepreviousexamplesofa(separate)
5Weuseatwo-sampleStudent’sT-Testtotestforsignificantdifferencebetweenthemeansoftheparticipantaccuraciesofeach
modelandthecontrolmodelandreportthenormalizeddifferenceinthemeans(asthet-statistic)andthep-value.
6Ifamodelconsistentlyproducestextsthataremoreimpressivethanhumanarticles,itispossiblethathumanperformanceon
thistaskwoulddropbelow50%.Indeed,manyindividualparticipantsscoredbelow50%onthistask.
7Additionalnon-newssamplescanbefoundinAppendixF.
26

Figure3.13: People’sabilitytoidentifywhethernewsarticlesaremodel-generated(measuredbytheratioofcorrect
assignmentstonon-neutralassignments)decreasesasmodelsizeincreases. Accuracyontheoutputsonthedeliberately-
badcontrolmodel(anunconditionedGPT-3Smallmodelwithhigheroutputrandomness)isindicatedwiththedashed
lineatthetop,andtherandomchance(50%)isindicatedwiththedashedlineatthebottom. Lineofbestfitisapower
lawwith95%confidenceintervals.
|           |              | 95%Confidence    | tcomparedto      | “Idon’tknow” |
| --------- | ------------ | ---------------- | ---------------- | ------------ |
|           | Meanaccuracy | Interval(low,hi) | control(p-value) | assignments  |
| Control   | 88%          | 84%–91%          | -                | 2.7%         |
| GPT-3175B | 52%          | 48%–57%          | 12.7(3.2e-23)    | 10.6%        |
Table3.12: People’sabilitytoidentifywhether∼500wordarticlesaremodelgenerated(asmeasuredbytheratioof
correctassignmentstonon-neutralassignments)was88%onthecontrolmodeland52%onGPT-3175B.Thistable
showstheresultsofatwo-sampleT-TestforthedifferenceinmeanaccuracybetweenGPT-3175Bandthecontrol
model(anunconditionalGPT-3Smallmodelwithincreasedoutputrandomness).
27

Title: United Methodists Agree to Historic Split
Subtitle: Those who oppose gay marriage will form their own denomination
Article: After two days of intense debate, the United Methodist Church
has agreed to a historic split - one that is expected to end in the
creation of a new denomination, one that will be "theologically and
socially conservative," according to The Washington Post. The majority of
delegates attending the church’s annual General Conference in May voted to
strengthen a ban on the ordination of LGBTQ clergy and to write new rules
that will "discipline" clergy who officiate at same-sex weddings. But
those who opposed these measures have a new plan: They say they will form a
separate denomination by 2020, calling their church the Christian Methodist
denomination.
The Post notes that the denomination, which claims 12.5 million members, was
in the early 20th century the "largest Protestant denomination in the U.S.,"
but that it has been shrinking in recent decades. The new split will be the
second in the church’s history. The first occurred in 1968, when roughly
10 percent of the denomination left to form the Evangelical United Brethren
Church. The Post notes that the proposed split "comes at a critical time
for the church, which has been losing members for years," which has been
"pushed toward the brink of a schism over the role of LGBTQ people in the
church." Gay marriage is not the only issue that has divided the church. In
2016, the denomination was split over ordination of transgender clergy, with
the North Pacific regional conference voting to ban them from serving as
clergy, and the South Pacific regional conference voting to allow them.
Figure3.14: TheGPT-3generatednewsarticlethathumanshadthegreatestdifficultydistinguishingfromahuman
writtenarticle(accuracy: 12%).
Title: Star’s Tux Promise Draws Megyn Kelly’s Sarcasm
Subtitle: Joaquin Phoenix pledged to not change for each awards event
Article: A year ago, Joaquin Phoenix made headlines when he appeared on
the red carpet at the Golden Globes wearing a tuxedo with a paper bag over
his head that read, "I am a shape-shifter. I can’t change the world. I
can only change myself." It was a promise to not change to fit into the
Hollywood mold: "I think that’s a really special thing, to not change
yourself. I think it’s a really special thing to say, ‘This is what’s
inside of me, I’m proud of it, and I’m not going to be ashamed because of
the way that someone else thinks I should be.’" Now, it’s the Oscars, and
Phoenix is at it again. But this time, his publicist is saying he’ll be
wearing a tux no matter what.
Megyn Kelly was not impressed, and she let him have it on The Tonight Show.
"You know, I feel like, I feel like you could have worn the tux," she says.
"But you’re saying you’re a shape-shifter. I don’t know if you can change
your tux, but you can change your mind. You can change your mind. You can
change your mind." Phoenix says he did, but it didn’t stick. "I was like,
‘Okay, I’m going to wear a tuxedo to this thing.’ And then I thought, ‘I
don’t want to wear a tuxedo to this thing.’" Kelly goes on to encourage him
to change his mind again, but Phoenix says it’s too late: "I’m committed to
wearing this."
Figure3.15: TheGPT-3generatednewsarticlethathumansfoundtheeasiesttodistinguishfromahumanwritten
article(accuracy: 61%).
28

A "whatpu" is a small, furry animal native to Tanzania. An example of a sentence that uses
the word whatpu is:
We were traveling in Africa and we saw these very cute whatpus.
To do a "farduddle" means to jump up and down really fast. An example of a sentence that uses
the word farduddle is:
One day when I was playing tag with my little sister, she got really excited and she
started doing these crazy farduddles.
A "yalubalu" is a type of vegetable that looks like a big pumpkin. An example of a sentence
that uses the word yalubalu is:
I was on a trip to Africa and I tried this yalubalu vegetable that was grown in a garden
there. It was delicious.
A "Burringo" is a car with very fast acceleration. An example of a sentence that uses the
word Burringo is:
In our garage we have a Burringo that my father drives to work every day.
A "Gigamuru" is a type of Japanese musical instrument. An example of a sentence that uses the
word Gigamuru is:
I have a Gigamuru that my uncle gave me as a gift. I love to play it at home.
To "screeg" something is to swing a sword at it. An example of a sentence that uses the word
screeg is:
We screeghed at each other for several minutes and then we went outside and ate ice cream.
Figure3.16: RepresentativeGPT-3completionsforthefew-shottaskofusinganewwordinasentence. Boldfaceis
GPT-3’scompletions,plaintextishumanprompts. Inthefirstexampleboththepromptandthecompletionareprovided
byahuman; thisthenservesasconditioningforsubsequentexampleswhereGPT-3receivessuccessiveadditional
promptsandprovidesthecompletions. Nothingtask-specificisprovidedtoGPT-3otherthantheconditioningshown
here.
nonexistentwordbeingdefinedandusedinasentence,sothetaskisfew-shotintermsofpreviousexamplesofthe
broadtaskandone-shotintermsofthespecificword. Table3.16showsthe6exampleswegenerated;alldefinitions
werehuman-generated,andthefirstanswerwashuman-generatedasconditioningwhilethesubsequentanswerswere
generatedbyGPT-3. Theseexamplesweregeneratedcontinuouslyinonesittingandwedidnotomitorrepeatedlytry
anyprompts. Inallcasesthegeneratedsentenceappearstobeacorrectoratleastplausibleuseoftheword. Inthefinal
sentencethemodelgeneratesaplausibleconjugationfortheword“screeg”(namely“screeghed”),althoughtheuseof
thewordisslightlyawkward(“screeghedateachother”)despitebeingplausibleinthesensethatitcoulddescribeatoy
swordfight. Overall,GPT-3appearstobeatleastproficientatthetaskofusingnovelwordsinasentence.
3.9.6 CorrectingEnglishGrammar
Anothertaskwellsuitedforfew-shotlearningiscorrectingEnglishgrammar. WetestthiswithGPT-3inthefew-
shot setting by giving prompts of the form "Poor English Input: <sentence>\n Good English Output:
<sentence>". WegiveGPT-3onehuman-generatedcorrectionandthenaskittocorrect5more(againwithoutany
omissionsorrepeats). ResultsareshowninFigure3.17.
4 MeasuringandPreventingMemorizationOfBenchmarks
Since our training dataset is sourced from the internet, it is possible that our model was trained on some of our
benchmarktestsets. Accuratelydetectingtestcontaminationfrominternet-scaledatasetsisanewareaofresearch
withoutestablishedbestpractices.Whileitiscommonpracticetotrainlargemodelswithoutinvestigatingcontamination,
giventheincreasingscaleofpretrainingdatasets,webelievethisissueisbecomingincreasinglyimportanttoattendto.
Thisconcernisnotjusthypothetical. OneofthefirstpaperstotrainalanguagemodelonCommonCrawldata[TL18]
detectedandremovedatrainingdocumentwhichoverlappedwithoneoftheirevaluationdatasets. Otherworksuch
asGPT-2[RWC+19]alsoconductedpost-hocoverlapanalysis. Theirstudywasrelativelyencouraging,findingthat
29

| Poor English | input:  | I eated the | purple | berries. |     |
| ------------ | ------- | ----------- | ------ | -------- | --- |
| Good English | output: | I ate the   | purple | berries. |     |
Poor English input: Thank you for picking me as your designer. I’d appreciate it.
Good English output: Thank you for choosing me as your designer. I appreciate it.
Poor English input: The mentioned changes have done. or I did the alteration that you
| requested. | or I changed | things | you wanted | and did | the modifications. |
| ---------- | ------------ | ------ | ---------- | ------- | ------------------ |
Good English output: The requested changes have been made. or I made the alteration that you
| requested. | or I changed | things | you wanted | and made | the modifications. |
| ---------- | ------------ | ------ | ---------- | -------- | ------------------ |
Poor English input: I’d be more than happy to work with you in another project.
Good English output: I’d be more than happy to work with you on another project.
Poor English input: Please provide me with a short brief of the design you’re looking for and
that’d be nice if you could share some examples or project you did before.
Good English output: Please provide me with a brief description of the design you’re
looking for and that would be nice if you could share some examples or projects you have
done before.
| Poor English | input:  | The patient   | was died.   |             |            |
| ------------ | ------- | ------------- | ----------- | ----------- | ---------- |
| Good English | output: | The patient   | died.       |             |            |
| Poor English | input:  | We think that | Leslie      | likes       | ourselves. |
| Good English | output: | We think      | that Leslie | likes       | us.        |
| Poor English | input:  | Janet broke   | Bill on     | the finger. |            |
| Good English | output: | Janet broke   | Bill’s      | finger.     |            |
Poor English input: Mary arranged for, in St. Louis, John to rent a house cheap.
Good English output: Mary arranged for John to rent a house in St. Louis.
Poor English input: Today I have went to the store to to buys some many bottle of water.
Good English output: Today I went to the store to buy some bottles of water.
Poor English input: I have tried to hit ball with bat, but my swing is has miss.
Good English output: I tried to hit the ball with the bat, but my swing missed.
Figure 3.17: Representative GPT-3 completions for the few-shot task of correcting English grammar. Boldface
is GPT-3’s completions, plain text is human prompts. In the first few examples example both the prompt and the
completionareprovidedbyahuman;thisthenservesasconditioningforsubsequentexampleswhereGPT-3receives
successiveadditionalpromptsandprovidesthecompletions. Nothingtask-specificisprovidedtoGPT-3asidefrom
thefirstfewexamplesasconditioningandthe“PoorEnglishinput/GoodEnglishoutput”framing. Wenotethatthe
distinctionbetween”poor”and”good”English(andthetermsthemselves)iscomplex,contextual,andcontested. As
theexamplementioningtherentalofahouseshows,assumptionsthatthemodelmakesaboutwhat“good”iscaneven
leadittomakeerrors(here,themodelnotonlyadjustsgrammar,butalsoremovestheword”cheap”inawaythatalters
meaning).
30

Figure4.1: GPT-3TrainingCurves Wemeasuremodelperformanceduringtrainingonadeduplicatedvalidation
splitofourtrainingdistribution. Thoughthereissomegapbetweentrainingandvalidationperformance,thegapgrows
onlyminimallywithmodelsizeandtrainingtime,suggestingthatmostofthegapcomesfromadifferenceindifficulty
ratherthanoverfitting.
although models did perform moderately better on data that overlapped between training and testing, this did not
significantlyimpactreportedresultsduetothesmallfractionofdatawhichwascontaminated(oftenonlyafewpercent).
GPT-3operatesinasomewhatdifferentregime. Ontheonehand,thedatasetandmodelsizeareabouttwoordersof
magnitudelargerthanthoseusedforGPT-2,andincludealargeamountofCommonCrawl,creatingincreasedpotential
forcontaminationandmemorization. Ontheotherhand,preciselyduetothelargeamountofdata,evenGPT-3175B
doesnotoverfititstrainingsetbyasignificantamount,measuredrelativetoaheld-outvalidationsetwithwhichitwas
deduplicated(Figure4.1). Thus,weexpectthatcontaminationislikelytobefrequent,butthatitseffectsmaynotbeas
largeasfeared.
Weinitiallytriedtoaddresstheissueofcontaminationbyproactivelysearchingforandattemptingtoremoveanyoverlap
betweenourtrainingdataandthedevelopmentandtestsetsofallbenchmarksstudiedinthispaper. Unfortunately,a
bugresultedinonlypartialremovalofalldetectedoverlapsfromthetrainingdata. Duetothecostoftraining,itwasn’t
feasibletoretrainthemodel. Toaddressthis, weinvestigateindetailhowtheremainingdetectedoverlapimpacts
results.
Foreachbenchmark,weproducea‘clean’versionwhichremovesallpotentiallyleakedexamples,definedroughlyas
examplesthathavea13-gramoverlapwithanythinginthepretrainingset(orthatoverlapwiththewholeexamplewhen
itisshorterthan13-grams). Thegoalistoveryconservativelyflaganythingthatcouldpotentiallybecontamination,
soastoproduceacleansubsetthatisfreeofcontaminationwithhighconfidence. Theexactprocedureisdetailedin
AppendixC.
We then evaluate GPT-3 on these clean benchmarks, and compare to the original score. If the score on the clean
subsetissimilartothescoreontheentiredataset,thissuggeststhatcontamination,evenifpresent,doesnothavea
significanteffectonreportedresults. Ifthescoreonthecleansubsetislower,thissuggestscontaminationmaybe
inflatingtheresults. TheresultsaresummarizedinFigure4.2. Althoughpotentialcontaminationisoftenhigh(witha
quarterofbenchmarksscoringover50%),inmostcasesperformancechangesonlynegligibly,andweseenoevidence
thatcontaminationlevelandperformancedifferencearecorrelated. Weconcludethateitherourconservativemethod
substantiallyoverestimatedcontaminationorthatcontaminationhaslittleeffectonperformance.
Below,wereviewinmoredetailthefewspecificcaseswhereeither(1)themodelperformssignificantlyworseon
thecleanedversion,or(2)potentialcontaminationisveryhigh,whichmakesmeasuringtheperformancedifference
difficult.
Ouranalysisflaggedsixgroupsofbenchmarksforfurtherinvestigation: WordScrambling,ReadingComprehension
(QuAC,SQuAD2,DROP),PIQA,Winograd,languagemodelingtasks(Wikitexttasks,1BW),andGermantoEnglish
31

Figure4.2: Benchmarkcontaminationanalysis Weconstructedcleanedversionsofeachofourbenchmarksto
checkforpotentialcontaminationinourtrainingset. Thex-axisisaconservativelowerboundforhowmuchofthe
datasetisknownwithhighconfidencetobeclean,andthey-axisshowsthedifferenceinperformancewhenevaluating
onlyontheverifiedcleansubset. Performanceonmostbenchmarkschangednegligibly,butsomewereflaggedfor
furtherreview. OninspectionwefindsomeevidenceforcontaminationofthePIQAandWinogradresults,andwemark
thecorrespondingresultsinSection3withanasterisk. Wefindnoevidencethatotherbenchmarksareaffected.
translation. Sinceouroverlapanalysisisdesignedtobeextremelyconservative,weexpectittoproducesomefalse
positives. Wesummarizetheresultsforeachgroupoftasksbelow:
• ReadingComprehension: Ourinitialanalysisflagged>90%oftaskexamplesfromQuAC,SQuAD2,and
DROPaspotentiallycontaminated,solargethatevenmeasuringthedifferentialonacleansubsetwasdifficult.
Uponmanualinspection,however,wefoundthatforeveryoverlapweinspected,inall3datasets,thesource
textwaspresentinourtrainingdatabutthequestion/answerpairswerenot,meaningthemodelgainsonly
backgroundinformationandcannotmemorizetheanswertoaspecificquestion.
• Germantranslation: Wefound25%oftheexamplesintheWMT16German-Englishtestsetweremarked
aspotentiallycontaminated,withanassociatedtotaleffectsizeof1-2BLEU.Uponinspection,noneofthe
flaggedexamplescontainpairedsentencesresemblingNMTtrainingdataandcollisionsweremonolingual
matchesmostlyofsnippetsofeventsdiscussedinthenews.
• Reversed Words and Anagrams: Recall that these tasks are of the form “alaok = koala”. Due to the
shortlengthofthesetasks,weused2-gramsforfiltering(ignoringpunctuation). Afterinspectingtheflagged
overlaps,wefoundthattheywerenottypicallyinstancesofrealreversalsorunscramblingsinthetrainingset,
butratherpalindromesortrivialunscramblings,e.g“kayak = kayak”. Theamountofoverlapwassmall,
butremovingthetrivialtasksleadtoanincreaseindifficultyandthusaspurioussignal. Relatedtothis,the
symbolinsertiontaskshowshighoverlapbutnoeffectonperformance–thisisbecausethattaskinvolves
removingnon-lettercharactersfromaword,andtheoverlapanalysisitselfignoressuchcharacters,leadingto
manyspuriousmatches.
• PIQA:Theoverlapanalysisflagged29%ofexamplesascontaminated,andobserveda3percentagepoint
absolutedecrease(4%relativedecrease)inperformanceonthecleansubset. Thoughthetestdatasetwas
released after our training set was created and its labels are hidden, some of the web pages used by the
crowdsourceddatasetcreatorsarecontainedinourtrainingset. Wefoundasimilardecreaseina25xsmaller
model with much less capacity to memorize, leading us to suspect that the shift is likely statistical bias
ratherthanmemorization;exampleswhichworkerscopiedmaysimplybeeasier. Unfortunately,wecannot
rigorouslyprovethishypothesis. WethereforemarkourPIQAresultswithanasterisktodenotethispotential
contamination.
• Winograd: Theoverlapanalysisflagged45%ofexamples,andfounda2.6%decreaseinperformanceonthe
cleansubset. Manualinspectionoftheoverlappingdatapointshowedthat132Winogradschemaswerein
factpresentinourtrainingset,thoughpresentedinadifferentformatthanwepresentthetasktothemodel.
Although the decrease in performance is small, we mark our Winograd results in the main paper with an
asterisk.
32

• Languagemodeling: Wefoundthe4WikipedialanguagemodelingbenchmarksmeasuredinGPT-2,plusthe
Children’sBookTestdataset,tobealmostentirelycontainedinourtrainingdata. Sincewecannotreliably
extractacleansubsethere,wedonotreportresultsonthesedatasets,eventhoughweintendedtowhenstarting
thiswork. WenotethatPennTreeBankduetoitsagewasunaffectedandthereforebecameourchieflanguage
modelingbenchmark.
Wealsoinspecteddatasetswherecontaminationwashigh,buttheimpactonperformancewasclosetozero,simply
toverifyhowmuchactualcontaminationexisted. Theseappearedtooftencontainfalsepositives. Theyhadeither
noactualcontamination,orhadcontaminationthatdidnotgiveawaytheanswertothetask. Onenotableexception
wasLAMBADA,whichappearedtohavesubstantialgenuinecontamination,yettheimpactonperformancewasvery
small,withthecleansubsetscoringwithin0.5%ofthefulldataset. Also,strictlyspeaking,ourfill-in-the-blankformat
precludesthesimplestformofmemorization. Nevertheless,sincewemadeverylargegainsonLAMBADAinthis
paper,thepotentialcontaminationisnotedintheresultssection.
Animportantlimitationofourcontaminationanalysisisthatwecannotbesurethatthecleansubsetisdrawnfromthe
samedistributionastheoriginaldataset. Itremainspossiblethatmemorizationinflatesresultsbutatthesametime
ispreciselycounteractedbysomestatisticalbiascausingthecleansubsettobeeasier. However,thesheernumber
ofshiftsclosetozerosuggeststhisisunlikely,andwealsoobservednonoticeabledifferenceintheshiftsforsmall
models,whichareunlikelytobememorizing.
Overall,wehavemadeabestefforttomeasureanddocumenttheeffectsofdatacontamination,andtonoteoroutright
removeproblematicresults,dependingontheseverity. Muchworkremainstobedonetoaddressthisimportantand
subtleissueforthefieldingeneral,bothwhendesigningbenchmarksandwhentrainingmodels. Foramoredetailed
explanationofouranalysis,wereferthereadertoAppendixC.
5 Limitations
GPT-3andouranalysisofithaveanumberoflimitations. Belowwedescribesomeoftheseandsuggestdirectionsfor
futurework.
First, despite the strong quantitative and qualitative improvements of GPT-3, particularly compared to its direct
predecessorGPT-2,itstillhasnotableweaknessesintextsynthesisandseveralNLPtasks. Ontextsynthesis,although
theoverallqualityishigh,GPT-3samplesstillsometimesrepeatthemselvessemanticallyatthedocumentlevel,startto
losecoherenceoversufficientlylongpassages,contradictthemselves,andoccasionallycontainnon-sequitursentences
orparagraphs. Wewillreleaseacollectionof500uncuratedunconditionalsamplestohelpprovideabettersenseof
GPT-3’slimitationsandstrengthsattextsynthesis. Withinthedomainofdiscretelanguagetasks,wehavenoticed
informallythatGPT-3seemstohavespecialdifficultywith“commonsensephysics”, despitedoingwellonsome
datasets(suchasPIQA[BZB+19])thattestthisdomain. SpecificallyGPT-3hasdifficultywithquestionsofthetype
“IfIputcheeseintothefridge,willitmelt?”. Quantitatively,GPT-3’sin-contextlearningperformancehassomenotable
gapsonoursuiteofbenchmarks,asdescribedinSection3,andinparticularitdoeslittlebetterthanchancewhen
evaluatedone-shotorevenfew-shotonsome“comparison”tasks,suchasdeterminingiftwowordsareusedthesame
wayinasentence,orifonesentenceimpliesanother(WICandANLIrespectively),aswellasonasubsetofreading
comprehensiontasks. ThisisespeciallystrikinggivenGPT-3’sstrongfew-shotperformanceonmanyothertasks.
GPT-3hasseveralstructuralandalgorithmiclimitations,whichcouldaccountforsomeoftheissuesabove. Wefocused
on exploring in-context learning behavior in autoregressive language models because it is straightforward to both
sampleandcomputelikelihoodswiththismodelclass. Asaresultourexperimentsdonotincludeanybidirectional
architecturesorothertrainingobjectivessuchasdenoising. Thisisanoticeabledifferencefrommuchoftherecent
literature, which has documented improved fine-tuning performance when using these approaches over standard
languagemodels[RSR+19]. Thusourdesigndecisioncomesatthecostofpotentiallyworseperformanceontasks
whichempiricallybenefitfrombidirectionality. Thismayincludefill-in-the-blanktasks,tasksthatinvolvelookingback
andcomparingtwopiecesofcontent,ortasksthatrequirere-readingorcarefullyconsideringalongpassageandthen
generatingaveryshortanswer. ThiscouldbeapossibleexplanationforGPT-3’slaggingfew-shotperformanceona
fewofthetasks,suchasWIC(whichinvolvescomparingtheuseofawordintwosentences),ANLI(whichinvolves
comparingtwosentencestoseeifoneimpliestheother),andseveralreadingcomprehensiontasks(e.g. QuACand
RACE).Wealsoconjecture,basedonpastliterature,thatalargebidirectionalmodelwouldbestrongeratfine-tuning
thanGPT-3. MakingabidirectionalmodelatthescaleofGPT-3,and/ortryingtomakebidirectionalmodelsworkwith
few-orzero-shotlearning,isapromisingdirectionforfutureresearch,andcouldhelpachievethe“bestofbothworlds”.
Amorefundamentallimitationofthegeneralapproachdescribedinthispaper–scalingupanyLM-likemodel,whether
autoregressiveorbidirectional–isthatitmayeventuallyruninto(orcouldalreadyberunninginto)thelimitsofthe
33

pretrainingobjective. Ourcurrentobjectiveweightseverytokenequallyandlacksanotionofwhatismostimportantto
predictandwhatislessimportant. [RRS20]demonstratebenefitsofcustomizingpredictiontoentitiesofinterest. Also,
withself-supervisedobjectives,taskspecificationreliesonforcingthedesiredtaskintoapredictionproblem,whereas
ultimately,usefullanguagesystems(forexamplevirtualassistants)mightbebetterthoughtofastakinggoal-directed
actionsratherthanjustmakingpredictions. Finally,largepretrainedlanguagemodelsarenotgroundedinotherdomains
ofexperience,suchasvideoorreal-worldphysicalinteraction,andthuslackalargeamountofcontextabouttheworld
[BHT+20]. Forallthesereasons,scalingpureself-supervisedpredictionislikelytohitlimits,andaugmentationwitha
differentapproachislikelytobenecessary. Promisingfuturedirectionsinthisveinmightincludelearningtheobjective
functionfromhumans[ZSW+19a],fine-tuningwithreinforcementlearning,oraddingadditionalmodalitiessuchas
imagestoprovidegroundingandabettermodeloftheworld[CLY+19].
Anotherlimitationbroadlysharedbylanguagemodelsispoorsampleefficiencyduringpre-training. WhileGPT-3
takesasteptowardstest-timesampleefficiencyclosertothatofhumans(one-shotorzero-shot),itstillseesmuchmore
textduringpre-trainingthanahumanseesinthetheirlifetime[Lin20]. Improvingpre-trainingsampleefficiencyis
animportantdirectionforfuturework,andmightcomefromgroundinginthephysicalworldtoprovideadditional
information,orfromalgorithmicimprovements.
Alimitation,oratleastuncertainty,associatedwithfew-shotlearninginGPT-3isambiguityaboutwhetherfew-shot
learningactuallylearnsnewtasks“fromscratch”atinferencetime,orifitsimplyrecognizesandidentifiestasksthatit
haslearnedduringtraining. Thesepossibilitiesexistonaspectrum,rangingfromdemonstrationsinthetrainingsetthat
aredrawnfromexactlythesamedistributionasthoseattesttime,torecognizingthesametaskbutinadifferentformat,
toadaptingtoaspecificstyleofageneraltasksuchasQA,tolearningaskillentirelydenovo. WhereGPT-3ison
thisspectrummayalsovaryfromtasktotask. Synthetictaskssuchaswordscramblingordefiningnonsensewords
seemespeciallylikelytobelearneddenovo,whereastranslationclearlymustbelearnedduringpretraining,although
possiblyfromdatathatisverydifferentinorganizationandstylethanthetestdata. Ultimately,itisnotevenclearwhat
humanslearnfromscratchvsfrompriordemonstrations. Evenorganizingdiversedemonstrationsduringpre-training
andidentifyingthemattesttimewouldbeanadvanceforlanguagemodels,butneverthelessunderstandingprecisely
howfew-shotlearningworksisanimportantunexploreddirectionforfutureresearch.
AlimitationassociatedwithmodelsatthescaleofGPT-3,regardlessofobjectivefunctionoralgorithm,isthattheyare
bothexpensiveandinconvenienttoperforminferenceon,whichmaypresentachallengeforpracticalapplicabilityof
modelsofthisscaleintheircurrentform. Onepossiblefuturedirectiontoaddressthisisdistillation[HVD15]oflarge
modelsdowntoamanageablesizeforspecifictasks. LargemodelssuchasGPT-3containaverywiderangeofskills,
mostofwhicharenotneededforaspecifictask,suggestingthatinprincipleaggressivedistillationmaybepossible.
Distillationiswell-exploredingeneral[LHCG19a]buthasnotbeentriedatthescaleofhundredofbillionsparameters;
newchallengesandopportunitiesmaybeassociatedwithapplyingittomodelsofthissize.
Finally,GPT-3sharessomelimitationscommontomostdeeplearningsystems–itsdecisionsarenoteasilyinterpretable,
it is not necessarily well-calibrated in its predictions on novel inputs as observed by the much higher variance in
performancethanhumansonstandardbenchmarks,anditretainsthebiasesofthedataithasbeentrainedon. This
lastissue–biasesinthedatathatmayleadthemodeltogeneratestereotypedorprejudicedcontent–isofspecial
concernfromasocietalperspective,andwillbediscussedalongwithotherissuesinthenextsectiononBroaderImpacts
(Section6).
6 BroaderImpacts
Languagemodelshaveawiderangeofbeneficialapplicationsforsociety,includingcodeandwritingauto-completion,
grammarassistance,gamenarrativegeneration,improvingsearchengineresponses,andansweringquestions. But
theyalsohavepotentiallyharmfulapplications. GPT-3improvesthequalityoftextgenerationandadaptabilityover
smallermodelsandincreasesthedifficultyofdistinguishingsynthetictextfromhuman-writtentext. Itthereforehasthe
potentialtoadvanceboththebeneficialandharmfulapplicationsoflanguagemodels.
Herewefocusonthepotentialharmsofimprovedlanguagemodels,notbecausewebelievetheharmsarenecessarily
greater,butinordertostimulateeffortstostudyandmitigatethem. Thebroaderimpactsoflanguagemodelslikethis
arenumerous. Wefocusontwoprimaryissues: thepotentialfordeliberatemisuseoflanguagemodelslikeGPT-3in
Section6.1,andissuesofbias,fairness,andrepresentationwithinmodelslikeGPT-3inSection6.2. Wealsobriefly
discussissuesofenergyefficiency(Section6.3).
34

6.1 MisuseofLanguageModels
Malicioususesoflanguagemodelscanbesomewhatdifficulttoanticipatebecausetheyofteninvolverepurposing
languagemodelsinaverydifferentenvironmentorforadifferentpurposethanresearchersintended. Tohelpwiththis,
wecanthinkintermsoftraditionalsecurityriskassessmentframeworks,whichoutlinekeystepssuchasidentifying
threatsandpotentialimpacts,assessinglikelihood,anddeterminingriskasacombinationoflikelihoodandimpact
[Ros12]. Wediscussthreefactors: potentialmisuseapplications,threatactors,andexternalincentivestructures.
6.1.1 PotentialMisuseApplications
Anysociallyharmfulactivitythatreliesongeneratingtextcouldbeaugmentedbypowerfullanguagemodels. Examples
includemisinformation,spam,phishing,abuseoflegalandgovernmentalprocesses,fraudulentacademicessaywriting
andsocialengineeringpretexting. Manyoftheseapplicationsbottleneckonhumanbeingstowritesufficientlyhigh
qualitytext. Languagemodelsthatproducehighqualitytextgenerationcouldlowerexistingbarrierstocarryingout
theseactivitiesandincreasetheirefficacy.
Themisusepotentialoflanguagemodelsincreasesasthequalityoftextsynthesisimproves. TheabilityofGPT-3to
generateseveralparagraphsofsyntheticcontentthatpeoplefinddifficulttodistinguishfromhuman-writtentextin
3.9.4representsaconcerningmilestoneinthisregard.
6.1.2 ThreatActorAnalysis
Threatactorscanbeorganizedbyskillandresourcelevels,rangingfromlowormoderatelyskilledandresourcedactors
whomaybeabletobuildamaliciousproductto‘advancedpersistentthreats’(APTs): highlyskilledandwell-resourced
(e.g. state-sponsored)groupswithlong-termagendas[SBC+19].
Tounderstandhowlowandmid-skillactorsthinkaboutlanguagemodels,wehavebeenmonitoringforumsandchat
groupswheremisinformationtactics,malwaredistribution,andcomputerfraudarefrequentlydiscussed. Whilewedid
findsignificantdiscussionofmisusefollowingtheinitialreleaseofGPT-2inspringof2019,wefoundfewerinstances
ofexperimentationandnosuccessfuldeploymentssincethen. Additionally,thosemisusediscussionswerecorrelated
withmediacoverageoflanguagemodeltechnologies. Fromthis,weassessthatthethreatofmisusefromtheseactorsis
notimmediate,butsignificantimprovementsinreliabilitycouldchangethis.
BecauseAPTsdonottypicallydiscussoperationsintheopen,wehaveconsultedwithprofessionalthreatanalystsabout
possibleAPTactivityinvolvingtheuseoflanguagemodels. SincethereleaseofGPT-2therehasbeennodiscernible
differenceinoperationsthatmayseepotentialgainsbyusinglanguagemodels. Theassessmentwasthatlanguage
modelsmaynotbeworthinvestingsignificantresourcesinbecausetherehasbeennoconvincingdemonstrationthat
currentlanguagemodelsaresignificantlybetterthancurrentmethodsforgeneratingtext,andbecausemethodsfor
“targeting”or“controlling”thecontentoflanguagemodelsarestillataveryearlystage.
6.1.3 ExternalIncentiveStructures
Eachthreatactorgroupalsohasasetoftactics,techniques,andprocedures(TTPs)thattheyrelyontoaccomplishtheir
agenda. TTPsareinfluencedbyeconomicfactorslikescalabilityandeaseofdeployment;phishingisextremelypopular
amongallgroupsbecauseitoffersalow-cost,low-effort,high-yieldmethodofdeployingmalwareandstealinglogin
credentials. UsinglanguagemodelstoaugmentexistingTTPswouldlikelyresultinanevenlowercostofdeployment.
Easeofuseisanothersignificantincentive. HavingstableinfrastructurehasalargeimpactontheadoptionofTTPs.
Theoutputsoflanguagemodelsarestochastic,however,andthoughdeveloperscanconstrainthese(e.g. usingtop-k
truncation)theyarenotabletoperformconsistentlywithouthumanfeedback. Ifasocialmediadisinformationbot
producesoutputsthatarereliable99%ofthetime,butproducesincoherentoutputs1%ofthetime,thiscouldreducethe
amountofhumanlaborrequiredinoperatingthisbot. Butahumanisstillneededtofiltertheoutputs,whichrestricts
howscalabletheoperationcanbe.
Basedonouranalysisofthismodelandanalysisofthreatactorsandthelandscape,wesuspectAIresearcherswill
eventuallydeveloplanguagemodelsthataresufficientlyconsistentandsteerablethattheywillbeofgreaterinterestto
maliciousactors. Weexpectthiswillintroducechallengesforthebroaderresearchcommunity,andhopetoworkon
thisthroughacombinationofmitigationresearch,prototyping,andcoordinatingwithothertechnicaldevelopers.
35

6.2 Fairness,Bias,andRepresentation
Biasespresentintrainingdatamayleadmodelstogeneratestereotypedorprejudicedcontent. Thisisconcerning,
sincemodelbiascouldharmpeopleintherelevantgroupsindifferentwaysbyentrenchingexistingstereotypesand
producingdemeaningportrayalsamongstotherpotentialharms[Cra17]. Wehaveconductedananalysisofbiasesin
themodelinordertobetterunderstandGPT-3’slimitationswhenitcomestofairness,bias,andrepresentation. 8
OurgoalisnottoexhaustivelycharacterizeGPT-3,buttogiveapreliminaryanalysisofsomeofitslimitationsand
behaviors. Wefocusonbiasesrelatingtogender,race,andreligion,althoughmanyothercategoriesofbiasarelikely
presentandcouldbestudiedinfollow-upwork. Thisisapreliminaryanalysisanddoesnotreflectallofthemodel’s
biasesevenwithinthestudiedcategories.
Broadly,ouranalysisindicatesthatinternet-trainedmodelshaveinternet-scalebiases;modelstendtoreflectstereotypes
presentintheirtrainingdata. Belowwediscussourpreliminaryfindingsofbiasalongthedimensionsofgender,race,
andreligion. Weprobeforbiasinthe175billionparametermodelandalsoinsimilarsmallermodels,toseeifandhow
theyaredifferentinthisdimension.
6.2.1 Gender
InourinvestigationofgenderbiasinGPT-3,wefocusedonassociationsbetweengenderandoccupation. Wefound
thatoccupationsingeneralhaveahigherprobabilityofbeingfollowedbyamalegenderidentifierthanafemaleone
(inotherwords,theyaremaleleaning)whengivenacontextsuchas"The {occupation} was a"(NeutralVariant).
83%ofthe388occupationswetestedweremorelikelytobefollowedbyamaleidentifierbyGPT-3. Wemeasured
this by feeding the model a context such as "The detective was a" and then looking at the probability of the
modelfollowingupwithmaleindicatingwords(eg. man,maleetc.) orfemaleindicatingwords(woman,femaleetc.).
Inparticular,occupationsdemonstratinghigherlevelsofeducationsuchaslegislator,banker,orprofessoremeritus
wereheavilymaleleaningalongwithoccupationsthatrequirehardphysicallaboursuchasmason,millwright,and
sheriff. Occupationsthatweremorelikelytobefollowedbyfemaleidentifiersincludemidwife,nurse,receptionist,
housekeeperetc.
Wealsotestedhowtheseprobabilitieschangedwhenweshiftedthecontexttobethe"The competent {occupation}
was a"(CompetentVariant),andwhenweshiftedthecontexttobe"The incompetent {occupation} was a"
(Incompetent Variant) for each occupation in the dataset. We found that, when prompted with "The competent
{occupation} was a," the majority of occupations had an even higher probability of being followed by a
male identifier than a female one than was the case with our original neutral prompt, "The {occupation} was
a". With the prompt "The incompetent {occupation} was a" the majority of occupations still leaned male
with a similar probability than for our original neutral prompt. The average occupation bias - measured as
1 (cid:80) log(P(female|Context))-was−1.11fortheNeutralVariant,−2.14fortheCompetentVariantand−1.15
njobs jobs P(male|Context))
fortheIncompetentVariant.
We also carried out pronoun resolution on the Winogender dataset [RNLVD18] using two methods which further
corroborated the model’s tendency to associate most occupations with males. One method measured the mod-
els ability to correctly assign a pronoun as the occupation or the participant. For example, we fed the model
acontextsuchas"The advisor met with the advisee because she wanted to get advice about job
applications. ‘She’ refers to the"andfoundtheoptionwiththelowestprobabilitybetweenthetwopossi-
bleoptions(ChoicesbetweenOccupationOption: advisor;ParticipantOption: advisee).
Occupationandparticipantwordsoftenhavesocietalbiasesassociatedwiththemsuchastheassumptionthatmost
occupantsarebydefaultmale. Wefoundthatthelanguagemodelslearntsomeofthesebiasessuchasatendencyto
associatefemalepronounswithparticipantpositionsmorethanmalepronouns. GPT-3175Bhadthehighestaccuracyof
allthemodels(64.17%)onthistask. ItwasalsotheonlymodelwheretheaccuracyforOccupantsentences(sentences
wherethecorrectanswerwastheOccupationoption)forfemaleswashigherthanformales(81.7%vs76.7%). All
othermodelshadahigheraccuracyformalepronounswithOccupationsentencesascomparedtofemalepronouns
withtheexceptionofoursecondlargestmodel-GPT-313B-whichhadthesameaccuracy(60%)forboth. Thisoffers
somepreliminaryevidencethatinplaceswhereissuesofbiascanmakelanguagemodelssusceptibletoerror,thelarger
modelsaremorerobustthansmallermodels.
Wealsoperformedco-occurrencetests,whereweanalyzedwhichwordsarelikelytooccurinthevicinityofotherpre-
selectedwords. Wecreatedamodeloutputsamplesetbygenerating800outputsoflength50eachwithatemperature
8Evaluatingfairness,bias,andrepresentationinlanguagemodelsisarapidly-developingareawithalargebodyofpriorwork.
See,forexample,[HZJ+19,NBR20,SCNP19].
36

Table6.1: MostBiasedDescriptiveWordsin175BModel
Top10MostBiasedMaleDescriptiveWordswithRaw Top10MostBiasedFemaleDescriptiveWordswithRaw
Co-OccurrenceCounts Co-OccurrenceCounts
AverageNumberofCo-OccurrencesAcrossAllWords: AverageNumberofCo-OccurrencesAcrossAllWords:
17.5 23.9
Large(16) Optimistic(12)
Mostly(15) Bubbly(12)
Lazy(14) Naughty(12)
Fantastic(13) Easy-going(12)
Eccentric(13) Petite(10)
Protect(10) Tight(10)
Jolly(10) Pregnant(10)
Stable(9) Gorgeous(28)
Personable(22) Sucked(8)
Survive(7) Beautiful(158)
of1andtop pof0.9foreverypromptinourdataset. Forgender,wehadpromptssuchas"He was very","She
was very","He would be described as","She would be described as"9. Welookedattheadjectivesand
adverbsinthetop100mostfavoredwordsusinganoff-the-shelfPOStagger[LB02]. Wefoundfemalesweremore
oftendescribedusingappearanceorientedwordssuchas”beautiful”and”gorgeous”ascomparedtomenwhowere
moreoftendescribedusingadjectivesthatspanagreaterspectrum.
Table6.1showsthetop10mostfavoreddescriptivewordsforthemodelalongwiththerawnumberoftimeseach
wordco-occurredwithapronounindicator. “MostFavored”hereindicateswordswhichweremostskewedtowardsa
categorybyco-occurringwithitatahigherrateascomparedtotheothercategory. Toputthesenumbersinperspective,
wehavealsoincludedtheaverageforthenumberofco-occurrencesacrossallqualifyingwordsforeachgender.
6.2.2 Race
To investigate racial bias in GPT-3, we seeded the model with prompts such as - "The {race} man was very",
"The {race} woman was very" and "People would describe the {race} person as" and generated 800
samplesforeachoftheaboveprompts,with{race}replacedwithatermindicatingaracialcategorysuchasWhite
orAsian. Wethenmeasurewordco-occurrencesinthegeneratedsamples. Givenpriorresearchdemonstratingthat
languagemodelsproducetextofdifferingsentimentwhenvaryingfeaturessuchasoccupation[HZJ+19],weexplored
howraceimpactedsentiment. WemeasuredsentimentusingSentiWordNet[BES10]forthewordswhichco-occurred
disproportionatelywitheachrace. Eachwordsentimentvariedfrom100to-100,withpositivescoresindicatingpositive
words(eg. wonderfulness: 100,amicable: 87.5),negativescoresindicatingnegativewords(eg. wretched: -87.5,horrid:
-87.5)andascoreof0indicatingneutralwords(eg. sloping,chalet).
Itshouldbenotedthatwewereexplicitlypromptingthemodelstotalkaboutraceandthisinturngeneratedtextthat
focusedonracialfeatures;theseresultsarenotfromthemodelstalkingaboutraceinthewildbuttalkingaboutracein
anexperimentalsetupwheretheyhavebeenprimedtodoso. Additionally,sincewearemeasuringsentimentbysimply
lookingatwordco-occurrences,theresultingsentimentcanreflectsocio-historicalfactors-forinstance,textrelatingto
adiscussionofslaverywillfrequentlyhaveanegativesentiment,whichmayleadtoademographicbeingassociated
withanegativesentimentunderthistestingmethodology.
Acrossthemodelsweanalyzed,‘Asian’hadaconsistentlyhighsentiment-itranked1stin3outof7models. Onthe
otherhand,’Black’hadaconsistentlylowsentiment-itrankedthelowestin5outof7models. Thesedifferences
narrowed marginally on the larger model sizes. This analysis gives a sense of the biases of different models and
highlightstheneedformoresophisticatedanalysisoftherelationshipbetweensentiment,entities,andinputdata.
9Weonlyusedmaleandfemalepronouns.Thissimplifyingassumptionmakesiteasiertostudyco-occurrencesinceitdoesnot
requiretheisolationofinstancesinwhich‘they’referstoasingularnounfromthosewhereitdidn’t,butotherformsofgenderbias
arelikelypresentandcouldbestudiedusingdifferentapproaches.
37

Figure6.1: RacialSentimentAcrossModels
Religion MostFavoredDescriptiveWords
Atheism ‘Theists’,‘Cool’,‘Agnostics’,‘Mad’,‘Theism’,‘Defensive’,‘Complaining’,‘Correct’,‘Arrogant’,
‘Characterized’
Buddhism ‘Myanmar’,‘Vegetarians’,‘Burma’,‘Fellowship’,‘Monk’,‘Japanese’,‘Reluctant’,‘Wisdom’,‘En-
lightenment’,‘Non-Violent’
Christianity ‘Attend’,‘Ignorant’,‘Response’,‘Judgmental’,‘Grace’,‘Execution’,‘Egypt’,‘Continue’,‘Com-
ments’,‘Officially’
Hinduism ‘Caste’,‘Cows’,‘BJP’,‘Kashmir’,‘Modi’,‘Celebrated’,‘Dharma’,‘Pakistani’,‘Originated’,‘Africa’
Islam ‘Pillars’,‘Terrorism’,‘Fasting’,‘Sheikh’,‘Non-Muslim’,‘Source’,‘Charities’,‘Levant’,‘Allah’,
‘Prophet’
Judaism ‘Gentiles’,‘Race’,‘Semites’,‘Whites’,‘Blacks’,‘Smartest’,‘Racists’,‘Arabs’,‘Game’,‘Russian’
Table6.2: ShowsthetenmostfavoredwordsabouteachreligionintheGPT-3175Bmodel.
6.2.3 Religion
Westudiedwhichwordsco-occurredwithreligioustermsrelatingtoAtheism,Buddhism,Christianity,Hinduism,Islam,
andJudaism, bygenerating800modeloutputsoflength≈50withatemperatureof1andatoppof0.9forevery
prompt. Ourpromptswereofthenature"{Religion practitioners} are"(Eg. "Christians are")foreach
ofthesixreligiouscategorieslistedabove. Wethenallowedthemodeltonaturallycarryoutcompletionsandcreateda
corpusofsuchcompletionsforstudyingco-occurrenceofwords.
Thefollowingisanexampleoutputfromthemodel:
"Buddhists are divided into two main branches - Theravada and Mahayana. Theravada
is the more conservative branch, centering on monastic life and the earliest sutras
and refusing to recognize the later Mahayana sutras as authentic."
Similartorace,wefoundthatthemodelsmakeassociationswithreligioustermsthatindicatesomepropensitytoreflect
howthesetermsaresometimespresentedintheworld. Forexample,withthereligionIslam,wefoundthatwordssuch
asramadan,prophetandmosqueco-occurredatahigherratethanforotherreligions. Wealsofoundthatwordssuch
asviolent,terrorismandterroristco-occurredatagreaterratewithIslamthanwithotherreligionsandwerein
thetop40mostfavoredwordsforIslaminGPT-3.
38

6.2.4 FutureBiasandFairnessChallenges
Wehavepresentedthispreliminaryanalysistosharesomeofthebiaseswefoundinordertomotivatefurtherresearch,
andtohighlighttheinherentdifficultiesincharacterizingbiasesinlarge-scalegenerativemodels;weexpectthistobean
areaofcontinuousresearchforusandareexcitedtodiscussdifferentmethodologicalapproacheswiththecommunity.
Weviewtheworkinthissectionassubjectivesignposting-wechosegender,race,andreligionasastartingpoint,but
werecognizetheinherentsubjectivityinthischoice. Ourworkisinspiredbytheliteratureoncharacterizingmodel
attributestodevelopinformativelabelssuchasModelCardsforModelReportingfrom[MWZ+18].
Ultimately,itisimportantnotjusttocharacterizebiasesinlanguagesystemsbuttointervene. Theliteratureonthis
isalsoextensive[QMZH19,HZJ+19],soweofferonlyafewbriefcommentsonfuturedirectionsspecifictolarge
languagemodels. Inordertopavethewayforeffectivebiaspreventioningeneralpurposemodels,thereisaneedfor
buildingacommonvocabularytyingtogetherthenormative,technicalandempiricalchallengesofbiasmitigationfor
thesemodels. ThereisroomformoreresearchthatengageswiththeliteratureoutsideNLP,betterarticulatesnormative
statementsaboutharm,andengageswiththelivedexperienceofcommunitiesaffectedbyNLPsystems[BBDIW20].
Thus,mitigationworkshouldnotbeapproachedpurelywithametricdrivenobjectiveto‘remove’biasasthishasbeen
showntohaveblindspots[GG19,NvNvdG19]butinaholisticmanner.
6.3 EnergyUsage
Practicallarge-scalepre-trainingrequireslargeamountsofcomputation,whichisenergy-intensive: trainingtheGPT-3
175Bconsumedseveralthousandpetaflop/s-daysofcomputeduringpre-training,comparedtotensofpetaflop/s-days
fora1.5BparameterGPT-2model(Figure2.2). Thismeansweshouldbecognizantofthecostandefficiencyofsuch
models,asadvocatedby[SDSE19].
Theuseoflarge-scalepre-trainingalsogivesanotherlensthroughwhichtoviewtheefficiencyoflargemodels-we
should consider not only the resources that go into training them, but how these resources are amortized over the
lifetimeofamodel,whichwillsubsequentlybeusedforavarietyofpurposesandfine-tunedforspecifictasks. Though
modelslikeGPT-3consumesignificantresourcesduringtraining,theycanbesurprisinglyefficientoncetrained: even
withthefullGPT-3175B,generating100pagesofcontentfromatrainedmodelcancostontheorderof0.4kW-hr,or
onlyafewcentsinenergycosts. Additionally,techniqueslikemodeldistillation[LHCG19a]canfurtherbringdown
thecostofsuchmodels,lettingusadoptaparadigmoftrainingsingle,large-scalemodels,thencreatingmoreefficient
versionsofthemforuseinappropriatecontexts. Algorithmicprogressmayalsonaturallyfurtherincreasetheefficiency
ofsuchmodelsovertime,similartotrendsobservedinimagerecognitionandneuralmachinetranslation[HB20].
7 RelatedWork
Several lines of work have focused on increasing parameter count and/or computation in language models as a
means to improve generative or task performance. An early work scaled LSTM based language models to over a
billionparameters[JVS+16]. Onelineofworkstraightforwardlyincreasesthesizeoftransformermodels,scaling
upparametersandFLOPS-per-tokenroughlyinproportion. Workinthisveinhassuccessivelyincreasedmodelsize:
213 million parameters [VSP+17] in the original paper, 300 million parameters [DCLT18], 1.5 billion parameters
[RWC+19],8billionparameters[SPP+19],11billionparameters[RSR+19],andmostrecently17billionparameters
[Tur20]. A second line of work has focused on increasing parameter count but not computation, as a means of
increasingmodels’capacitytostoreinformationwithoutincreasedcomputationalcost. Theseapproachesrelyonthe
conditionalcomputationframework[BLC13]andspecifically,themixture-of-expertsmethod[SMM+17]hasbeen
usedtoproduce100billionparametermodelsandmorerecently50billionparametertranslationmodels[AJF19],
thoughonlyasmallfractionoftheparametersareactuallyusedoneachforwardpass. Athirdapproachincreases
computationwithoutincreasingparameters;examplesofthisapproachincludeadaptivecomputationtime[Gra16]and
theuniversaltransformer[DGV+18]. Ourworkfocusesonthefirstapproach(scalingcomputeandparameterstogether,
bystraightforwardlymakingtheneuralnetlarger),andincreasesmodelsize10xbeyondpreviousmodelsthatemploy
thisstrategy.
Several efforts have also systematically studied the effect of scale on language model performance. [KMH+20,
RRBS19,LWS+20,HNA+17],findasmoothpower-lawtrendinlossasautoregressivelanguagemodelsarescaledup.
Thisworksuggeststhatthistrendlargelycontinuesasmodelscontinuetoscaleup(althoughaslightbendingofthe
curvecanperhapsbedetectedinFigure3.1),andwealsofindrelativelysmoothincreasesinmany(thoughnotall)
downstreamtasksacross3ordersofmagnitudeofscaling.
Anotherlineofworkgoesintheoppositedirectionfromscaling,attemptingtopreservestrongperformanceinlanguage
modelsthatareassmallaspossible. ThisapproachincludesALBERT[LCG+19]aswellasgeneral[HVD15]and
39

task-specific [SDCW19, JYS+19, KR16] approaches to distillation of language models. These architectures and
techniquesarepotentiallycomplementarytoourwork,andcouldbeappliedtodecreaselatencyandmemoryfootprint
ofgiantmodels.
Asfine-tunedlanguagemodelshavenearedhumanperformanceonmanystandardbenchmarktasks, considerable
efforthasbeendevotedtoconstructingmoredifficultoropen-endedtasks,includingquestionanswering[KPR+19,
IBGC+14,CCE+18,MCKS18],readingcomprehension[CHI+18,RCM19],andadversariallyconstructeddatasets
designedtobedifficultforexistinglanguagemodels[SBBC19,NWD+19]. Inthisworkwetestourmodelsonmany
ofthesedatasets.
Manypreviouseffortshavefocusedspecificallyonquestion-answering,whichconstitutesasignificantfractionofthe
taskswetestedon. Recenteffortsinclude[RSR+19,RRS20],whichfine-tunedan11billionparameterlanguagemodel,
and[GLT+20],whichfocusedonattendingoveralargecorpusofdataattesttime. Ourworkdiffersinfocusingon
in-contextlearningbutcouldbecombinedinthefuturewiththoseof[GLT+20,LPP+20].
Metalearning in language models has been utilized in [RWC+19], though with much more limited results and no
systematic study. More broadly, language model metalearning has an inner-loop-outer-loop structure, making it
structurally similar to metalearning as applied to ML in general. Here there is an extensive literature, including
matchingnetworks[VBL+16],RL2[DSC+16],learningtooptimize[RL16,ADG+16,LM17]andMAML[FAL17].
Our approach of stuffing the model’s context with previous examples is most structurally similar to RL2 and also
resembles[HYC01],inthataninnerloopofadaptationtakesplacethroughcomputationinthemodel’sactivations
acrosstimesteps,withoutupdatingtheweights,whileanouterloop(inthiscasejustlanguagemodelpre-training)
updatestheweights,andimplicitlylearnstheabilitytoadapttooratleastrecognizetasksdefinedatinference-time.
Few-shotauto-regressivedensityestimationwasexploredin [RCP+17]and[GWC+18]studiedlow-resourceNMTas
afew-shotlearningproblem.
Whilethemechanismofourfew-shotapproachisdifferent,priorworkhasalsoexploredwaysofusingpre-trained
languagemodelsincombinationwithgradientdescenttoperformfew-shotlearning[SS20]. Anothersub-fieldwith
similargoalsissemi-supervisedlearningwhereapproachessuchasUDA[XDH+19]alsoexploremethodsoffine-tuning
whenverylittlelabeleddataisavailable.
Givingmulti-taskmodelsinstructionsinnaturallanguagewasfirstformalizedinasupervisedsettingwith[MKXS18]
andutilizedforsometasks(suchassummarizing)inalanguagemodelwith[RWC+19]. Thenotionofpresenting
tasksinnaturallanguagewasalsoexploredinthetext-to-texttransformer[RSR+19],althoughthereitwasappliedfor
multi-taskfine-tuningratherthanforin-contextlearningwithoutweightupdates.
Anotherapproachtoincreasinggeneralityandtransfer-learningcapabilityinlanguagemodelsismulti-tasklearning
[Car97],whichfine-tunesonamixtureofdownstreamtaskstogether,ratherthanseparatelyupdatingtheweightsfor
eachone. Ifsuccessfulmulti-tasklearningcouldallowasinglemodeltobeusedformanytaskswithoutupdatingthe
weights(similartoourin-contextlearningapproach),oralternativelycouldimprovesampleefficiencywhenupdating
theweightsforanewtask. Multi-tasklearninghasshownsomepromisinginitialresults[LGH+15,LSP+18]and
multi-stagefine-tuninghasrecentlybecomeastandardizedpartofSOTAresultsonsomedatasets[PFB18]andpushed
theboundariesoncertaintasks[KKS+20],butisstilllimitedbytheneedtomanuallycuratecollectionsofdatasetsand
setuptrainingcurricula. Bycontrastpre-trainingatlargeenoughscaleappearstooffera“natural”broaddistributionof
tasksimplicitlycontainedinpredictingthetextitself. Onedirectionforfutureworkmightbeattemptingtogenerate
abroadersetofexplicittasksformulti-tasklearning,forexamplethroughproceduralgeneration[TFR+17],human
interaction[ZSW+19b],oractivelearning[Mac92].
Algorithmicinnovationinlanguagemodelsoverthelasttwoyearshasbeenenormous, includingdenoising-based
bidirectionality[DCLT18],prefixLM[DL15]andencoder-decoderarchitectures[LLG+19,RSR+19],randompermu-
tationsduringtraining[YDY+19],architecturesthatimprovetheefficiencyofsampling[DYY+19],improvementsin
dataandtrainingprocedures[LOG+19],andefficiencyincreasesintheembeddingparameters[LCG+19]. Manyof
thesetechniquesprovidesignificantgainsondownstreamtasks.Inthisworkwecontinuetofocusonpureautoregressive
languagemodels,bothinordertofocusonin-contextlearningperformanceandtoreducethecomplexityofourlarge
modelimplementations. However,itisverylikelythatincorporatingthesealgorithmicadvancescouldimproveGPT-3’s
performance on downstream tasks, especially in the fine-tuning setting, and combining GPT-3’s scale with these
algorithmictechniquesisapromisingdirectionforfuturework.
8 Conclusion
We presented a 175 billion parameter language model which shows strong performance on many NLP tasks and
benchmarks in the zero-shot, one-shot, and few-shot settings, in some cases nearly matching the performance of
40

state-of-the-artfine-tunedsystems,aswellasgeneratinghigh-qualitysamplesandstrongqualitativeperformanceat
tasksdefinedon-the-fly. Wedocumentedroughlypredictabletrendsofscalinginperformancewithoutusingfine-tuning.
Wealsodiscussedthesocialimpactsofthisclassofmodel. Despitemanylimitationsandweaknesses,theseresults
suggest that very large language models may be an important ingredient in the development of adaptable, general
languagesystems.
Acknowledgements
The authors would like to thank Ryan Lowe for giving detailed feedback on drafts of the paper. Thanks to Jakub
PachockiandSzymonSidorforsuggestingtasks,andGregBrockman,MichaelPetrov,BrookeChan,andChelsea
VossforhelpingrunevaluationsonOpenAI’sinfrastructure. ThankstoDavidLuanforinitialsupportinscalingup
thisproject,IreneSolaimanfordiscussionsaboutwaystoapproachandevaluatebias,HarrisonEdwardsandYura
Burdafordiscussionsandexperimentationwithin-contextlearning, GeoffreyIrvingandPaulChristianoforearly
discussionsoflanguagemodelscaling,LongOuyangforadvisingonthedesignofthehumanevaluationexperiments,
ChrisHallacyfordiscussionsondatacollection,andShanCarterforhelpwithvisualdesign. Thankstothemillionsof
peoplewhocreatedcontentthatwasusedinthetrainingofthemodel,andtothosewhowereinvolvedinindexingor
upvotingthecontent(inthecaseofWebText). Additionally,wewouldliketothanktheentireOpenAIinfrastructure
andsupercomputingteamsformakingitpossibletotrainmodelsatthisscale.
41

Contributions
Tom Brown, Ben Mann, Prafulla Dhariwal, Dario Amodei, Nick Ryder, Daniel M Ziegler, and Jeffrey Wu
implementedthelarge-scalemodels,traininginfrastructure,andmodel-parallelstrategies.
TomBrown,DarioAmodei,BenMann,andNickRyderconductedpre-trainingexperiments.
BenMannandAlecRadfordcollected,filtered,deduplicated,andconductedoverlapanalysisonthetrainingdata.
MelanieSubbiah,BenMann,DarioAmodei,JaredKaplan,SamMcCandlish,TomBrown,TomHenighan,and
GirishSastryimplementedthedownstreamtasksandthesoftwareframeworkforsupportingthem,includingcreation
ofsynthetictasks.
JaredKaplanandSamMcCandlishinitiallypredictedthatagiantlanguagemodelshouldshowcontinuedgains,and
appliedscalinglawstohelppredictandguidemodelanddatascalingdecisionsfortheresearch.
BenMannimplementedsamplingwithoutreplacementduringtraining.
AlecRadfordoriginallydemonstratedfew-shotlearningoccursinlanguagemodels.
JaredKaplanandSamMcCandlishshowedthatlargermodelslearnmorequicklyin-context,andsystematically
studiedin-contextlearningcurves,taskprompting,andevaluationmethods.
PrafullaDhariwalimplementedanearlyversionofthecodebase,anddevelopedthememoryoptimizationsforfully
half-precisiontraining.
RewonChildandMarkChendevelopedanearlyversionofourmodel-parallelstrategy.
RewonChildandScottGraycontributedthesparsetransformer.
AdityaRameshexperimentedwithlossscalingstrategiesforpretraining.
MelanieSubbiahandArvindNeelakantanimplemented,experimentedwith,andtestedbeamsearch.
PranavShyamworkedonSuperGLUEandassistedwithconnectionstofew-shotlearningandmeta-learningliterature.
SandhiniAgarwalconductedthefairnessandrepresentationanalysis.
GirishSastryandAmandaAskellconductedthehumanevaluationsofthemodel.
ArielHerbert-Vossconductedthethreatanalysisofmalicioususe.
GretchenKruegereditedandred-teamedthepolicysectionsofthepaper.
Benjamin Chess, Clemens Winter, Eric Sigler, Christopher Hesse, Mateusz Litwin, and Christopher Berner
optimizedOpenAI’sclusterstorunthelargestmodelsefficiently.
ScottGraydevelopedfastGPUkernelsusedduringtraining.
JackClarkledtheanalysisofethicalimpacts—fairnessandrepresentation,humanassessmentsofthemodel,and
broaderimpactsanalysis,andadvisedGretchen,Amanda,Girish,Sandhini,andArielontheirwork.
Dario Amodei, Alec Radford, Tom Brown, Sam McCandlish, Nick Ryder, Jared Kaplan, Sandhini Agarwal,
AmandaAskell,GirishSastry,andJackClarkwrotethepaper.
SamMcCandlishledtheanalysisofmodelscaling,andadvisedTomHenighanandJaredKaplanontheirwork.
AlecRadfordadvisedtheprojectfromanNLPperspective,suggestedtasks,puttheresultsincontext,anddemonstrated
thebenefitofweightdecayfortraining.
IlyaSutskeverwasanearlyadvocateforscalinglargegenerativelikelihoodmodels,andadvisedPranav,Prafulla,
Rewon,Alec,andAdityaontheirwork.
DarioAmodeidesignedandledtheresearch.
42

A DetailsofCommonCrawlFiltering
AsmentionedinSection2.2,weemployedtwotechniquestoimprovethequalityoftheCommonCrawldataset: (1)
filteringCommonCrawland(2)fuzzydeduplication:
1. InordertoimprovethequalityofCommonCrawl,wedevelopedanautomaticfilteringmethodtoremovelow
qualitydocuments. UsingtheoriginalWebTextasaproxyforhigh-qualitydocuments,wetrainedaclassifier
todistinguishthesefromrawCommonCrawl. Wethenusedthisclassifiertore-sampleCommonCrawlby
prioritizingdocumentswhichwerepredictedbytheclassifiertobehigherquality. Theclassifieristrained
usinglogisticregressionclassifierwithfeaturesfromSpark’sstandardtokenizerandHashingTF10.Forthe
positiveexamples,weusedacollectionofcurateddatasetssuchasWebText,Wikiedia,andourwebbooks
corpusasthepositiveexamples,andforthenegativeexamples,weusedunfilteredCommonCrawl. Weused
thisclassifiertoscoreCommonCrawldocuments. Wekepteachdocumentinourdatasetiff
np.random.pareto(α)>1−document_score
Wechoseα=9inordertotakemostlydocumentstheclassifierscoredhighly,butstillincludesomedocuments
thatwereoutofdistribution. αwaschosentomatchthedistributionofscoresfromourclassifieronWebText.
Wefoundthisre-weightingincreasedqualityasmeasuredbylossonarangeofout-of-distributiongenerative
textsamples.
2. Tofurtherimprovemodelqualityandpreventoverfitting(whichbecomesincreasinglyimportantasmodel
capacity increases), we fuzzily deduplicated documents (i.e. removed documents with high overlap with
otherdocuments)withineachdatasetusingSpark’sMinHashLSHimplementationwith10hashes,usingthe
samefeaturesaswereusedforclassificationabove. WealsofuzzilyremovedWebTextfromCommonCrawl.
Overallthisdecreaseddatasetsizebyanaverageof10%.
Afterfilteringforduplicatesandquality,wealsopartiallyremovedtextoccurringinbenchmarkdatasets,describedin
AppendixC.
B DetailsofModelTraining
TotrainallversionsofGPT-3,weuseAdamwithβ =0.9,β =0.95,and(cid:15)=10−8,wecliptheglobalnormofthe
1 2
gradientat1.0,andweusecosinedecayforlearningratedownto10%ofitsvalue,over260billiontokens(after260
billiontokens,trainingcontinuesat10%oftheoriginallearningrate). ThereisalinearLRwarmupoverthefirst375
milliontokens. Wealsograduallyincreasethebatchsizelinearlyfromasmallvalue(32ktokens)tothefullvalueover
thefirst4-12billiontokensoftraining,dependingonthemodelsize. Dataaresampledwithoutreplacementduring
training(untilanepochboundaryisreached)tominimizeoverfitting. Allmodelsuseweightdecayof0.1toprovidea
smallamountofregularization[LH17].
During training we always train on sequences of the full n = 2048 token context window, packing multiple
ctx
documentsintoasinglesequencewhendocumentsareshorterthan2048,inordertoincreasecomputationalefficiency.
Sequences with multiple documents are not masked in any special way but instead documents within a sequence
are delimited with a special end of text token, giving the language model the information necessary to infer that
contextseparatedbytheendoftexttokenisunrelated. Thisallowsforefficienttrainingwithoutneedforanyspecial
sequence-specificmasking.
C DetailsofTestSetContaminationStudies
Insection 4we gavea highleveloverview oftest setcontamination studies. Inthissection weprovidedetailson
methodologyandresults.
Initialtrainingsetfiltering Weattemptedtoremovetextoccurringinbenchmarksfromtrainingdatabysearching
for 13−gram overlaps between all test/development sets used in this work and our training data, and we removed
thecolliding13−gramaswellasa200characterwindowaroundit,splittingtheoriginaldocumentintopieces. For
filteringpurposeswedefineagramasalowercase,whitespacedelimitedwordwithnopunctuation. Pieceslessthan
200characterslongwerediscarded. Documentssplitintomorethan10pieceswereconsideredcontaminatedand
10https://spark.apache.org/docs/latest/api/python/pyspark.ml.html#pyspark.ml.feature.HashingTF
43

removedentirely. Originallyweremovedentiredocumentsgivenasinglecollision,butthatoverlypenalizedlong
documentssuchasbooksforfalsepositives. AnexampleofafalsepositivemightbeatestsetbasedonWikipedia,in
whichtheWikipediaarticlequotesasinglelinefromabook. Weignored13−gramsthatmatchedmorethan10training
documents,asinspectionshowedthemajorityofthesetocontaincommonculturalphrases,legalboilerplate,orsimilar
contentthatwelikelydowantthemodeltolearn,ratherthanundesiredspecificoverlapswithtestsets. Examplesfor
variousfrequenciescanbefoundintheGPT-3releaserepository11.
Overlapmethodology ForourbenchmarkoverlapanalysisinSection4,weusedavariablenumberofwordsN to
checkforoverlapforeachdataset,whereN isthe5thpercentileexamplelengthinwords,ignoringallpunctuation,
whitespace,andcasing. DuetospuriouscollisionsatlowervaluesofN weuseaminimumvalueof8onnon-synthetic
tasks. Forperformancereasons,wesetamaximumvalueof13foralltasks. ValuesforN andtheamountofdata
markedasdirtyareshowninTableC.1. UnlikeGPT-2’suseofbloomfilterstocomputeprobabilisticboundsfortest
contamination,weusedApacheSparktocomputeexactcollisionsacrossalltrainingandtestsets. Wecomputeoverlaps
betweentestsetsandourfulltrainingcorpus,eventhoughweonlytrainedon40%ofourfilteredCommonCrawl
documentsperSection2.2.
Wedefinea‘dirty’exampleasonewithanyN-gramoverlapwithanytrainingdocument,anda‘clean’exampleasone
withnocollision.
Testandvalidationsplitshadsimilarcontaminationlevelsdespitesometestsplitsbeingunlabeled.Duetoabugrevealed
bythisanalysis,filteringdescribedabovefailedonlongdocumentssuchasbooks. Becauseofcostconsiderationsit
wasinfeasibletoretrainthemodelonacorrectedversionofthetrainingdataset. Assuch,severallanguagemodeling
benchmarksplustheChildren’sBookTestshowedalmostcompleteoverlap,andthereforewerenotincludedinthis
paper. OverlapsareshowninTableC.1
Overlapresults Tounderstandhowmuchhavingseensomeofthedatahelpsthemodelperformondownstream
tasks,wefiltereveryvalidationandtestsetbydirtiness. Thenwerunevaluationontheclean-onlyexamplesandreport
therelativepercentchangebetweenthecleanscoreandtheoriginalscore. Ifthecleanscoreismorethan1%or2%
worsethantheoverallscore,itsuggeststhemodelmayhaveoverfittotheexamplesithasseen. Ifthecleanscoreis
significantlybetter,ourfilteringschememayhavepreferentiallymarkedeasierexamplesasdirty.
Thisoverlapmetrictendstoshowahighrateoffalsepositivesfordatasetsthatcontainbackgroundinformation(but
not answers) drawn from the web (such as SQuAD, which draws from Wikipedia) or examples less than 8 words
long,whichweignoredinourfilteringprocess(exceptforwordscramblingtasks). Oneinstancewherethistechnique
seemstofailtogivegoodsignalisDROP,areadingcomprehensiontaskinwhich94%oftheexamplesaredirty. The
informationrequiredtoanswerthequestionisinapassageprovidedtothemodel,sohavingseenthepassageduring
trainingbutnotthequestionsandanswersdoesnotmeaningfullyconstitutecheating. Weconfirmedthateverymatching
trainingdocumentcontainedonlythesourcepassage,andnoneofthequestionsandanswersinthedataset. Themore
likelyexplanationforthedecreaseinperformanceisthatthe6%ofexamplesthatremainafterfilteringcomefroma
slightlydifferentdistributionthanthedirtyexamples.
Figure4.2showsthatasthedatasetbecomesmorecontaminated,thevarianceoftheclean/allfractionincreases,but
thereisnoapparentbiastowardsimprovedordegradedperformance. ThissuggeststhatGPT-3isrelativelyinsensitive
tocontamination. SeeSection4fordetailsonthedatasetsweflaggedforfurtherreview.
11https://github.com/openai/gpt-3/blob/master/overlap_frequency.md
44

Relative
|     |     |     |       | Dirty | Dirty |       |             |            |
| --- | --- | --- | ----- | ----- | ----- | ----- | ----------- | ---------- |
|     |     |     | Total |       |       | Clean | Clean Clean | Difference |
Name Split Metric N Acc/F1/BLEU Count Acc/F1/BLEU Count Acc/F1/BLEU Count Percentage CleanvsAll
| Quac    | dev f1 | 13 44.3 | 7353  | 44.3 | 7315  | 54.1 | 38 1%  | 20%  |
| ------- | ------ | ------- | ----- | ---- | ----- | ---- | ------ | ---- |
| SQuADv2 | dev f1 | 13 69.8 | 11873 | 69.9 | 11136 | 68.4 | 737 6% | -2%  |
| DROP    | dev f1 | 13 36.5 | 9536  | 37.0 | 8898  | 29.5 | 638 7% | -21% |
SymbolInsertion dev acc 7 66.9 10000 66.8 8565 67.1 1435 14% 0%
| CoQa     | dev f1   | 13 86.0 | 7983  | 85.3 | 5107 | 87.1 | 2876 36% | 1%  |
| -------- | -------- | ------- | ----- | ---- | ---- | ---- | -------- | --- |
| ReCoRD   | dev acc  | 13 89.5 | 10000 | 90.3 | 6110 | 88.2 | 3890 39% | -1% |
| Winograd | test acc | 9 88.6  | 273   | 90.2 | 164  | 86.2 | 109 40%  | -3% |
| BoolQ    | dev acc  | 13 76.0 | 3270  | 75.8 | 1955 | 76.3 | 1315 40% | 0%  |
| MultiRC  | dev acc  | 13 74.2 | 953   | 73.4 | 558  | 75.3 | 395 41%  | 1%  |
| RACE-h   | test acc | 13 46.8 | 3498  | 47.0 | 1580 | 46.7 | 1918 55% | 0%  |
| LAMBADA  | test acc | 13 86.4 | 5153  | 86.9 | 2209 | 86.0 | 2944 57% | 0%  |
LAMBADA(NoBlanks) test acc 13 77.8 5153 78.5 2209 77.2 2944 57% -1%
| WSC           | dev acc      | 13 76.9 | 104   | 73.8  | 42   | 79.0 | 62 60%   | 3%   |
| ------------- | ------------ | ------- | ----- | ----- | ---- | ---- | -------- | ---- |
| PIQA          | dev acc      | 8 82.3  | 1838  | 89.9  | 526  | 79.3 | 1312 71% | -4%  |
| RACE-m        | test acc     | 13 58.5 | 1436  | 53.0  | 366  | 60.4 | 1070 75% | 3%   |
| De→En16       | test bleu-sb | 12 43.0 | 2999  | 47.4  | 739  | 40.8 | 2260 75% | -5%  |
| En→De16       | test bleu-sb | 12 30.9 | 2999  | 32.6  | 739  | 29.9 | 2260 75% | -3%  |
| En→Ro16       | test bleu-sb | 12 25.8 | 1999  | 24.9  | 423  | 26.1 | 1576 79% | 1%   |
| Ro→En16       | test bleu-sb | 12 41.3 | 1999  | 40.4  | 423  | 41.6 | 1576 79% | 1%   |
| WebQs         | test acc     | 8 41.5  | 2032  | 41.6  | 428  | 41.5 | 1604 79% | 0%   |
| ANLIR1        | test acc     | 13 36.8 | 1000  | 40.5  | 200  | 35.9 | 800 80%  | -3%  |
| ANLIR2        | test acc     | 13 34.0 | 1000  | 29.4  | 177  | 35.0 | 823 82%  | 3%   |
| TriviaQA      | dev acc      | 10 71.2 | 7993  | 70.8  | 1390 | 71.3 | 6603 83% | 0%   |
| ANLIR3        | test acc     | 13 40.2 | 1200  | 38.3  | 196  | 40.5 | 1004 84% | 1%   |
| En→Fr14       | test bleu-sb | 13 39.9 | 3003  | 38.3  | 411  | 40.3 | 2592 86% | 1%   |
| Fr→En14       | test bleu-sb | 13 41.4 | 3003  | 40.9  | 411  | 41.4 | 2592 86% | 0%   |
| WiC           | dev acc      | 13 51.4 | 638   | 53.1  | 49   | 51.3 | 589 92%  | 0%   |
| RTE           | dev acc      | 13 71.5 | 277   | 71.4  | 21   | 71.5 | 256 92%  | 0%   |
| CB            | dev acc      | 13 80.4 | 56    | 100.0 | 4    | 78.8 | 52 93%   | -2%  |
| Anagrams2     | dev acc      | 2 40.2  | 10000 | 76.2  | 705  | 37.4 | 9295 93% | -7%  |
| ReversedWords | dev acc      | 2 0.4   | 10000 | 1.5   | 660  | 0.3  | 9340 93% | -26% |
| OpenBookQA    | test acc     | 8 65.4  | 500   | 58.1  | 31   | 65.9 | 469 94%  | 1%   |
| ARC(Easy)     | test acc     | 11 70.1 | 2268  | 77.5  | 89   | 69.8 | 2179 96% | 0%   |
| Anagrams1     | dev acc      | 2 15.0  | 10000 | 49.8  | 327  | 13.8 | 9673 97% | -8%  |
| COPA          | dev acc      | 9 93.0  | 100   | 100.0 | 3    | 92.8 | 97 97%   | 0%   |
ARC(Challenge) test acc 12 51.6 1144 45.2 31 51.8 1113 97% 0%
| HellaSwag     | dev acc  | 13 79.3 | 10042 | 86.2  | 152 | 79.2 | 9890 98%  | 0%  |
| ------------- | -------- | ------- | ----- | ----- | --- | ---- | --------- | --- |
| NQs           | test acc | 11 29.9 | 3610  | 32.7  | 52  | 29.8 | 3558 99%  | 0%  |
| CycledLetters | dev acc  | 2 38.6  | 10000 | 20.5  | 73  | 38.7 | 9927 99%  | 0%  |
| SATAnalogies  | dev acc  | 9 65.8  | 374   | 100.0 | 2   | 65.6 | 372 99%   | 0%  |
| StoryCloze    | test acc | 13 87.7 | 1871  | 100.0 | 2   | 87.6 | 1869 100% | 0%  |
| Winogrande    | dev acc  | 13 77.7 | 1267  | -     | 0   | 77.7 | 1267 100% | 0%  |
TableC.1: Overlapstatisticsforalldatasetssortedfromdirtiesttocleanest. Weconsideradatasetexampledirtyifit
hasasingleN-gramcollisionwithanydocumentinourtrainingcorpus. “RelativeDifferenceCleanvsAll”showsthe
percentchangeinperformancebetweenonlythecleanexamplesvsalltheexamplesinthebenchmark. “Count”shows
thenumberofexamples. “Cleanpercentage”isthepercentofexamplesthatarecleanvstotal. For“Acc/F1/BLEU”we
usethemetricspecifiedin“Metric”. Thesescorescomefromevaluationswithadifferentseedfortherandomexamples
usedforin-contextlearning,andwillthereforedifferslightlyfromthescoreselsewhereinthepaper.
45

D TotalComputeUsedtoTrainLanguageModels
Thisappendixcontainsthecalculationsthatwereusedtoderivetheapproximatecomputeusedtotrainthelanguage
modelsinFigure2.2. Asasimplifyingassumption,weignoretheattentionoperation,asittypicallyuseslessthan10%
ofthetotalcomputeforthemodelsweareanalyzing.
CalculationscanbeseeninTableD.1andareexplainedwithinthetablecaption.
Fwd-pass
Fracof
|     |     |     |     | Flops |     | flopsper | paramsactive |
| --- | --- | --- | --- | ----- | --- | -------- | ------------ |
Totaltrain Totaltrain
|     | compute compute |        | Trainingtokens | perparam |         | activeparam |         |
| --- | --------------- | ------ | -------------- | -------- | ------- | ----------- | ------- |
|     |                 | Params |                |          | Multfor |             | foreach |
Model (PF-days) (flops) (M) (billions) pertoken bwdpass pertoken token
| T5-Small      | 2.08E+00 1.80E+20 | 60      | 1,000 | 3   | 3   | 1   | 0.5 |
| ------------- | ----------------- | ------- | ----- | --- | --- | --- | --- |
| T5-Base       | 7.64E+00 6.60E+20 | 220     | 1,000 | 3   | 3   | 1   | 0.5 |
| T5-Large      | 2.67E+01 2.31E+21 | 770     | 1,000 | 3   | 3   | 1   | 0.5 |
| T5-3B         | 1.04E+02 9.00E+21 | 3,000   | 1,000 | 3   | 3   | 1   | 0.5 |
| T5-11B        | 3.82E+02 3.30E+22 | 11,000  | 1,000 | 3   | 3   | 1   | 0.5 |
| BERT-Base     | 1.89E+00 1.64E+20 | 109     | 250   | 6   | 3   | 2   | 1.0 |
| BERT-Large    | 6.16E+00 5.33E+20 | 355     | 250   | 6   | 3   | 2   | 1.0 |
| RoBERTa-Base  | 1.74E+01 1.50E+21 | 125     | 2,000 | 6   | 3   | 2   | 1.0 |
| RoBERTa-Large | 4.93E+01 4.26E+21 | 355     | 2,000 | 6   | 3   | 2   | 1.0 |
| GPT-3Small    | 2.60E+00 2.25E+20 | 125     | 300   | 6   | 3   | 2   | 1.0 |
| GPT-3Medium   | 7.42E+00 6.41E+20 | 356     | 300   | 6   | 3   | 2   | 1.0 |
| GPT-3Large    | 1.58E+01 1.37E+21 | 760     | 300   | 6   | 3   | 2   | 1.0 |
| GPT-3XL       | 2.75E+01 2.38E+21 | 1,320   | 300   | 6   | 3   | 2   | 1.0 |
| GPT-32.7B     | 5.52E+01 4.77E+21 | 2,650   | 300   | 6   | 3   | 2   | 1.0 |
| GPT-36.7B     | 1.39E+02 1.20E+22 | 6,660   | 300   | 6   | 3   | 2   | 1.0 |
| GPT-313B      | 2.68E+02 2.31E+22 | 12,850  | 300   | 6   | 3   | 2   | 1.0 |
| GPT-3175B     | 3.64E+03 3.14E+23 | 174,600 | 300   | 6   | 3   | 2   | 1.0 |
TableD.1: Startingfromtherighthandsideandmovingleft,webeginwiththenumberoftrainingtokensthateach
modelwastrainedwith. NextwenotethatsinceT5usesanencoder-decodermodel,onlyhalfoftheparametersare
activeforeachtokenduringaforwardorbackwardspass. Wethennotethateachtokenisinvolvedinasingleaddition
andasinglemultiplyforeachactiveparameterintheforwardpass(ignoringattention). Thenweaddamultiplierof
3xtoaccountforthebackwardspass(ascomputingboth ∂params and ∂acts useasimilaramountofcomputeasthe
∂loss ∂loss
forwardspass. Combiningtheprevioustwonumbers,wegetthetotalflopsperparameterpertoken. Wemultiplythis
valuebythetotaltrainingtokensandthetotalparameterstoyieldthenumberoftotalflopsusedduringtraining. We
reportbothflopsandpetaflop/s-day(eachofwhichare8.64e+19flops).
E HumanQualityAssessmentofSyntheticNewsArticles
ThisappendixcontainsdetailsontheexperimentsmeasuringhumanabilitytodistinguishGPT-3-generatedsynthetic
newsarticlesfromrealnewsarticles. Wefirstdescribetheexperimentsonthe∼ 200wordnewsarticles,andthen
describethepreliminaryinvestigationof∼500wordnewsarticlesgeneratedbyGPT-3.
Participants: Werecruited718uniqueparticipantstotakepartin6experiments. 97participantswereexcludedfor
failing an internet check question, leaving a total of 621 participants: 343 male, 271 female, and 7 other. Mean
| participantagewas∼ | 38yearsold. |     |     |     |     |     |     |
| ------------------ | ----------- | --- | --- | --- | --- | --- | --- |
AllparticipantswererecruitedthroughPositly,whichmaintainsawhitelistof
high-performingworkersfromMechanicalTurk. AllparticipantswereUS-basedbuttherewerenootherdemographic
restrictions. Participantswerepaid$12fortheirparticipation,basedonatasktimeestimateof60minutesdetermined
bypilotruns. Inordertoensurethatthesampleofparticipantsforeachexperimentquizwasunique,participantswere
notallowedtotakepartinanexperimentmorethanonce.
Procedureanddesign:
Wearbitrarilyselected25newsarticlesthatappearedinnewser.cominearly2020. Weused
thearticletitlesandsubtitlestoproduceoutputsfromthe125M,350M,760M,1.3B,2.7B,6.7B,13.0B,and200B
(GPT-3)parameterlanguagemodels. Fiveoutputsperquestionweregeneratedbyeachmodelandthegenerationwitha
wordcountclosesttothatofthehumanwrittenarticlewasselectedautomatically. Thiswastominimizetheeffect
thatcompletionlengthmighthaveonparticipants’judgments. Thesameoutputprocedureforeachmodelwiththe
exceptionoftheremovaloftheintentionallybadcontrolmodel,asdescribedinthemaintext.
46

Average
|             | Participants | Participants | Genders     | Mean WordCount    |
| ----------- | ------------ | ------------ | ----------- | ----------------- |
| Model       | Recruited    | Excluded     | (m:f:other) | Age (human:model) |
| Control     | 76           | 7            | 32:37:0     | 39 216:216        |
| GPT-3Small  | 80           | 7            | 41:31:1     | 40 216:188        |
| GPT-3Medium | 80           | 7            | 46:28:2     | 39 216:202        |
| GPT-3Large  | 81           | 24           | 46:28:2     | 37 216:200        |
| GPT-3XL     | 79           | 14           | 32:32:1     | 38 216:199        |
| GPT-32.7B   | 80           | 11           | 36:33:0     | 40 216:202        |
| GPT-36.7B   | 76           | 5            | 46:28:2     | 37 216:195        |
| GPT-313.0B  | 81           | 13           | 46:28:2     | 37 216:209        |
| GPT-3175B   | 80           | 9            | 42:29:0     | 37 216:216        |
TableE.1:Participantdetailsandarticlelengthsforeachexperimenttoevaluatehumandetectionof∼200wordmodel
generatednewsarticles. Participantswereexcludedduetointernetcheckfails.
FigureE.1: Participantsspendmoretimetryingtoidentifywhethereachnewsarticleismachinegeneratedasmodel
sizeincreases. Durationonthecontrolmodelisindicatedwiththedashedline. Lineofbestfitisalinearmodelonalog
scalewith95%confidenceintervals.
Ineachexperiment,halfoftheparticipantswererandomlyassignedtoquizAandhalfwererandomlyassignedtoquiz
B.Eachquizconsistedof25articles: half(12-13)werehumanwrittenandhalf(12-13)weremodelgenerated: the
articleswithhumanwrittencompletionsinquizAhadmodelgeneratedcompletionsinquizBandviceversa. The
orderofquizquestionwasshuffledforeachparticipant. Participantscouldleavecommentsandwereaskedtoindicate
iftheyhadseenthearticlesbefore. Participantswereinstructednottolookupthearticlesortheircontentduringthe
quizandattheendofthequizwereaskediftheyhadlookedanythingupduringthequiz.
StatisticalTests: Tocomparemeansonthedifferentruns,weperformedatwo-samplet-testforindependentgroupsfor
eachmodelagainstthecontrol. ThiswasimplementedinPythonusingthescipy.stats.ttest_indfunction. When
plottingaregressionlineinthegraphofaverageparticipantaccuracyvsmodelsize,wefitapowerlawoftheform
ax−b. The95%confidenceintervalswereestimatedfromthet-distributionofthesamplemean.
Duration statistics: Inthe main text, we discussedthe findingthat theability ofhuman participantsto distinguish
model and human generated news articles decreases as our models become larger. We have also found that the
averagetimespentforagivensetofquestionsincreasesasthemodelsizeincreases,asshowninFigureE.1. Lower
47

Average
Participants Participants Genders Mean WordCount
Model Recruited Excluded (m:f:other) Age (human:model)
Control 79 17 32:37:0 39 569:464
GPT-3175B 81 19 32:30:0 40 569:498
TableE.2: Participantdetailsandarticlelengthsfortheexperimentsinvestigatinghumandetectionof∼ 500word
modelgeneratednewsarticles. Participantswereexcludedduetointernetcheckfails.
accuracyscoresdespiteincreasedtimeinvestmentfromparticipantssupportsthefindingthatlargermodelsgenerate
harder-to-distinguishnewsarticles.
Preliminaryinvestigationof∼ 500wordarticles: Werecruited160uniqueUS-basedparticipantstotakepartin2
experimentsthroughPositly(detailsaregiveninTableE.2). Werandomlyselected12Reutersworldnewsarticlesfrom
late2019andcreatedacontextforGPT-3175BthatconsistedofasingleReutersarticlenotinthissetof12. Wethen
usedthearticletitlesandReuterslocationstogeneratecompletionsfromGPT-3175Bandthe160Mcontrolmodel
fromthepreviousexperiments. Thesewereusedtocreatetwo12-questionquizzespermodel,eachconsistingofhalf
humanwrittenandhalfmodelgeneratedarticles. Comprehensionquestionswereaddedandarticleswereshownto
participantsin3stagesat30secondintervalstoencouragecloserreading. Participantswerepaid$12forthistask.
Modelgenerationselectionmethods,exclusioncriteria,andstatisticaltestsmirrorthoseofthepreviousexperiments.
F AdditionalSamplesfromGPT-3
GPT-3adaptswelltomanytasksotherthantheonesexploredinthemainbodyofthepaper. Asanexample,inFigure
F.1,weshowfouruncuratedsamplesfromapromptsuggestingthatthemodelwriteapoem,withagiventitle,inthe
styleofWallaceStevens. Wefirstexperimentedwithafewprompts,thengeneratedfoursampleswithnoadditional
editingorselection(samplingattemperature1usingnucleussampling[HBFC19]withP =0.9). Completionswere
truncatedwhenthemodelbegantowriteanewtitleandauthorheading,orbrokeintoprosecommentary.
48

| Context → |     |     | The City |     |     |
| --------- | --- | --- | -------- | --- | --- |
BY C. P. CAVAFY
|     |     |     | TRANSLATED | BY EDMUND KEELEY |     |
| --- | --- | --- | ---------- | ---------------- | --- |
|     |     |     | [Poem text | omitted]         |     |
SOME TREES
John Ashbery
|     |     |     | [Poem text | omitted] |     |
| --- | --- | --- | ---------- | -------- | --- |
|     |     |     | Shadows on | the Way  |     |
Wallace Stevens
| -------- | Generated Poem | 1 -------- | -------- | Generated Poem | 3 -------- |
| -------- | -------------- | ---------- | -------- | -------------- | ---------- |
I must have shadows on the way The sun was all we had. Now, in the shade
If I am to walk I must have All is changed. The mind must dwell on those
Each step taken slowly and alone White fields, that to its eyes were always old;
| To have it  | ready made        |             | Those ancient | gleams, convoluting |                 |
| ----------- | ----------------- | ----------- | ------------- | ------------------- | --------------- |
|             |                   |             | The way they  | lay among           | the huge roots, |
| And I must  | think in lines    | of grey     | The great     | dark tomes of       | reverie,        |
| To have dim | thoughts to       | be my guide | The plumed    | labyrinth of        | the sea.        |
| Must look   | on blue and green |             |               |                     |                 |
And never let my eye forget When our own breath gonne faint and fade
| That color | is my friend  |         | Up the long   | stairway of   | the dead       |
| ---------- | ------------- | ------- | ------------- | ------------- | -------------- |
| And purple | must surround | me too  | We shall      | remember well |                |
|            |               |         | The blindness | of the light, | the whiteness  |
| The yellow | of the sun is | no more | Of that white | land. The     | footsteps, and |
Intrusive than the bluish snow The grasses in that light, and in the shade
| That falls    | on all of us. | I must have           | The menacing | life. |     |
| ------------- | ------------- | --------------------- | ------------ | ----- | --- |
| Grey thoughts | and blue      | thoughts walk with me |              |       |     |
If I am to go away at all. We played, too, once, in the warmest rooms.
|              |                     |                          | To one content,    | there is           | one content  |
| ------------ | ------------------- | ------------------------ | ------------------ | ------------------ | ------------ |
| --------     | Generated Poem      | 2 --------               | For all mankind.   | The forest         | glades       |
|              |                     |                          | Are all the        | more for being     | in fable,    |
| There is     | a way in the world. |                          | And wood           | and town in legend | shadowed-    |
| That way     | a man may live      | in a small town          | Once more          | to return. The     | one content  |
| His lifetime | and see no          | man come,                | Has in it          | every happiness,   | more brave   |
| Never the    | stir of men about   | a market,                | For being          | purposeless;       | and so       |
| Never the    | bobbing of covered  | carts,                   | Those island       | gardens, deep      | in the mind, |
| Never the    | creak passed        | on the stair             | Make of remoteness | familiarity        |              |
| Closing some | other life;         | an old man               | And of the         | unspoken name      | a friend.    |
| Can prosper  | in that town,       | can prosper              |                    |                    |              |
| When his     | store is seen       | to close, his wife       | --------           | Generated Poem     | 4 --------   |
| Fades in     | his house, and      | the world shouts in vain |                    |                    |              |
That no one comes to hear him Nobody will come to this place. It is a road that leads nowhere.
Where his small bell tolls. The solitude is deep. The mountains are high.
In that small town But they are desolate, and they turn the traveler’s face
Everything is known. Towards the North. All the sounds of the world are far away.
| The ways     | of the young men | are known, | When the   | wind rises above   | the trees, |
| ------------ | ---------------- | ---------- | ---------- | ------------------ | ---------- |
| And the ways | of the young     | women      | The boughs | bow to the ground. |            |
As they walk to the Spring; Even the birds that inhabit the tangle of weeds
The rumors are all known, That is the roadside cover, are silent. One listens,
The quarrels, the hurt, the envy But hears no roar of the forest. One is alone.
| Of the men | and the women. |     | One will | be taken. |     |
| ---------- | -------------- | --- | -------- | --------- | --- |
| Till a day | comes          |     | One will | be taken. |     |
That way out of the world There is no utterance, there is no conversation,
| That leads | to a wood.      |                     | But one is   | uneasy all the    | same.... |
| ---------- | --------------- | ------------------- | ------------ | ----------------- | -------- |
| Young, the | young man       |                     | There is     | a thin blue mist, |          |
| Walks, a   | lover now,      |                     | A darkness   | rising like       | smoke,   |
| Knows the  | streets as they | are and is of them. | And within   | that darkness     |          |
|            |                 |                     | A possession | of the heart.     |          |
Comes to the wood. One will be taken.... It was here, and it will be here again-
|                 |                   |                     | Here, under | this sky empty | and full of light. |
| --------------- | ----------------- | ------------------- | ----------- | -------------- | ------------------ |
| There, in       | the wood, among   | trees,              |             |                |                    |
| He sees shadows | on the            | way, hears voices,  |             |                |                    |
| hears the       | wind and the      | rustling of leaves; |             |                |                    |
| Through an      | open glade        |                     |             |                |                    |
| He sees a       | shape and the     | shape hears:        |             |                |                    |
| It waits        | as he waits,      |                     |             |                |                    |
| Waits as        | the shadows wait, |                     |             |                |                    |
| As the voices   | wait;             |                     |             |                |                    |
| Shadows on      | the way, voices   | in the wind.        |             |                |                    |
FigureF.1: FouruncuratedcompletionsfromacontextsuggestingthemodelcomposeapoeminthestyleofWallace
Stevenswiththetitle‘ShadowsontheWay’.
49

G DetailsofTaskPhrasingandSpecifications
Thefollowingfiguresillustratetheformattingandphrasingofallthetasksincludedinthepaper. Alldatacomesfrom
thegroundtruthdatasetsinthissection,andnosamplesfromGPT-3areincludedhere.
Context → Article:
|     | Informal |     | conversation | is  | an important |     | part of | any | business |     |     |
| --- | -------- | --- | ------------ | --- | ------------ | --- | ------- | --- | -------- | --- | --- |
relationship.Before you start a discussion,however,make sure you understand
which topics are suitable and which are considered taboo in a particular
|     | culture. |     | Latin Americans     |     | enjoy | sharing | information |     | about      | their      | local |
| --- | -------- | --- | ------------------- | --- | ----- | ------- | ----------- | --- | ---------- | ---------- | ----- |
|     | history, |     | art and customs.You |     | may   | expect  | questions   |     | about your | family,and |       |
be sure to show pictures of your children.You may feel free to ask similar
questions of your Latin American friends.The French think of conversation
as an art form,and they enjoy the value of lively discussions as well as
disagreements. For them,arguments can be interesting and they can cover
pretty much or any topic ---- as long as they occur in are respectful and
|     | intelligent      |            | manner.              |                      |           |                         |            |          |              |              |        |
| --- | ---------------- | ---------- | -------------------- | -------------------- | --------- | ----------------------- | ---------- | -------- | ------------ | ------------ | ------ |
|     | In               | the United | States,business      |                      | people    | like                    | to         | discuss  | a wide       | range        | of     |
|     | topics,including |            | opinions             |                      | about     | work,family,hobbies,and |            |          | politics.    |              | In     |
|     | Japan,China,and  |            | Korea,however,people |                      |           | are                     | much       | more     | private.They |              | do not |
|     | share            | much       | about their          | thoughts,feelings,or |           |                         |            | emotions | because      | they         | feel   |
|     | that             | doing      | so might             | take                 | away from | the                     | harmonious |          | business     | relationship |        |
|     | they’re          | trying     | to                   | build.Middle         |           | Easterners              | are        | also     | private      | about        | their  |
personal lives and family matters.It is considered rude,for example,to ask
|     | a businessman |           | from         | Saudi | Arabia | about   | his wife | or           | children. |          |        |
| --- | ------------- | --------- | ------------ | ----- | ------ | ------- | -------- | ------------ | --------- | -------- | ------ |
|     | As            | a general | rule,it’s    | best  | not    | to talk | about    | politics     | or        | religion | with   |
|     | your          | business  | friends.This |       | can    | get you | into     | trouble,even |           | in the   | United |
States,where people hold different religious views.In addition,discussing
|     | one’s    | salary | is usually |      | considered | unsuitable.Sports |                |     | is typically |     | a      |
| --- | -------- | ------ | ---------- | ---- | ---------- | ----------------- | -------------- | --- | ------------ | --- | ------ |
|     | friendly |        | subject in | most | parts      | of the            | world,although |     | be careful   |     | not to |
criticize national sport.Instead,be friendly and praise your host’s team.
|     | Q:      | What shouldn’t |              | you do | when talking |             | about   | sports   | with colleagues |     | from   |
| --- | ------- | -------------- | ------------ | ------ | ------------ | ----------- | ------- | -------- | --------------- | --- | ------ |
|     | another | country?       |              |        |              |             |         |          |                 |     |        |
|     | A:      | Criticizing    | the          | sports | of your      | colleagues’ |         | country. |                 |     |        |
|     | Q:      | Which          | is typically | a      | friendly     | topic       | in most | places   | according       |     | to the |
author?
A: Sports.
Q: Why are people from Asia more private in their conversation with others?
A: They don’t want to have their good relationship with others harmed by
|     | informal |            | conversation. |     |          |              |     |     |     |     |     |
| --- | -------- | ---------- | ------------- | --- | -------- | ------------ | --- | --- | --- | --- | --- |
|     | Q:       | The author | considers     |     | politics | and religion |     | .   |     |     |     |
A:
| Correct Answer   | → taboo    |        |           |     |        |       |     |     |     |     |     |
| ---------------- | ---------- | ------ | --------- | --- | ------ | ----- | --- | --- | --- | --- | --- |
| Incorrect Answer | → cheerful |        | topics    |     |        |       |     |     |     |     |     |
| Incorrect Answer | → rude     | topics |           |     |        |       |     |     |     |     |     |
| Incorrect Answer | → topics   | that   | can never | be  | talked | about |     |     |     |     |     |
FigureG.1: FormatteddatasetexampleforRACE-h. Whenpredicting,wenormalizebytheunconditionalprobability
ofeachanswerasdescribedin2.
50

Context → anli 2: anli 2: The Gold Coast Hotel & Casino is a hotel and casino
| located | in Paradise, | Nevada. | This | locals’ |     | casino | is owned | and | operated |
| ------- | ------------ | ------- | ---- | ------- | --- | ------ | -------- | --- | -------- |
by Boyd Gaming. The Gold Coast is located one mile (∼ 1.6km) west of the
| Las Vegas | Strip on     | West Flamingo |      | Road.           | It      | is located | across |       | the street |
| --------- | ------------ | ------------- | ---- | --------------- | ------- | ---------- | ------ | ----- | ---------- |
| from the  | Palms Casino | Resort        | and  | the             | Rio All | Suite      | Hotel  | and   | Casino.    |
| Question: | The Gold     | Coast         | is a | budget-friendly |         | casino.    |        | True, | False, or  |
Neither?
Correct Answer → Neither
Incorrect Answer → True
Incorrect Answer → False
| FigureG.2: | FormatteddatasetexampleforANLIR2 |     |     |     |     |     |     |     |     |
| ---------- | -------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- |
Context → Article:
| Mrs. Smith | is an | unusual | teacher. | Once | she | told | each | student | to bring |
| ---------- | ----- | ------- | -------- | ---- | --- | ---- | ---- | ------- | -------- |
along a few potatoes in plastic bag. On each potato the students had to
| write a | name of a | person | that they | hated | And | the | next day, | every | child |
| ------- | --------- | ------ | --------- | ----- | --- | --- | --------- | ----- | ----- |
brought some potatoes. Some had two potatoes;some three;some up to five.
Mrs. Smith then told the children to carry the bags everywhere they went,
even to the toilet, for two weeks. As day after day passed, the children
| started | to complain | about | the awful | smell | of  | the | rotten | potatoes. |     |
| ------- | ----------- | ----- | --------- | ----- | --- | --- | ------ | --------- | --- |
Those children who brought five potatoes began to feel the weight trouble
| of the | bags. After | two weeks, |     | the children |     | were | happy | to hear | that the |
| ------ | ----------- | ---------- | --- | ------------ | --- | ---- | ----- | ------- | -------- |
game was finally ended. Mrs. Smith asked,"How did you feel while carrying
| the potatoes | for two | weeks?" | The | children | started |     | complaining |     | about the |
| ------------ | ------- | ------- | --- | -------- | ------- | --- | ----------- | --- | --------- |
trouble loudly.
| Then Mrs. | Smith told | them | why | she asked | them | to  | play the | game. | She |
| --------- | ---------- | ---- | --- | --------- | ---- | --- | -------- | ----- | --- |
said,"This is exactly the situation when you carry your hatred for somebody
| inside | your heart. | The terrible |     | smell | of the | hatred | will | pollute | your |
| ------ | ----------- | ------------ | --- | ----- | ------ | ------ | ---- | ------- | ---- |
heart and you will carry something unnecessary with you all the time. If
you cannot stand the smell of the rotten potatoes for just two weeks, can
you imagine how heavy it would be to have the hatred in your heart for your
lifetime? So throw away any hatred from your heart, and you’ll be really
happy."
| Q: Which  | of the following    |                | is True | according |           | to the   | passage? |           |     |
| --------- | ------------------- | -------------- | ------- | --------- | --------- | -------- | -------- | --------- | --- |
| A: If a   | kid hated           | four people,he |         | or she    | had       | to carry | four     | potatoes. |     |
| Q: We can | learn from          | the            | passage | that      | we should |          | .        |           |     |
| A: throw  | away the            | hatred         | inside  |           |           |          |          |           |     |
| Q: The    | children complained |                | about   | besides   | the       | weight   | trouble. |           |     |
A: the smell
| Q: Mrs.Smith | asked | her students |     | to write | on  | the | potatoes. |     |     |
| ------------ | ----- | ------------ | --- | -------- | --- | --- | --------- | --- | --- |
A:
→
Correct Answer names
→
Incorrect Answer numbers
→
Incorrect Answer time
Incorrect Answer → places
FigureG.3: FormatteddatasetexampleforRACE-m. Whenpredicting,wenormalizebytheunconditionalprobability
ofeachanswerasdescribedin2.
51

|     | Context | → How | to apply | sealant | to wood. |     |     |     |     |     |     |     |
| --- | ------- | ----- | -------- | ------- | -------- | --- | --- | --- | --- | --- | --- | --- |
Correct Answer → Using a brush, brush on sealant onto wood until it is fully saturated with
the sealant.
Incorrect Answer → Using a brush, drip on sealant onto wood until it is fully saturated with
the sealant.
|           |         |           | FigureG.4: | FormatteddatasetexampleforPIQA |      |           |     |         |     |     |     |     |
| --------- | ------- | --------- | ---------- | ------------------------------ | ---- | --------- | --- | ------- | --- | --- | --- | --- |
|           | Context | → My body | cast       | a shadow                       | over | the grass |     | because |     |     |     |     |
| Correct   | Answer  | → the     | sun was    | rising.                        |      |           |     |         |     |     |     |     |
| Incorrect | Answer  | → the     | grass      | was cut.                       |      |           |     |         |     |     |     |     |
|           |         |           | FigureG.5: | FormatteddatasetexampleforCOPA |      |           |     |         |     |     |     |     |
Context → (CNN) Yuval Rabin, whose father, Yitzhak Rabin, was assassinated while
serving as Prime Minister of Israel, criticized Donald Trump for appealing
|     |     | to "Second  |     | Amendment     | people" | in       | a speech | and       | warned | that       | the  | words that |
| --- | --- | ----------- | --- | ------------- | ------- | -------- | -------- | --------- | ------ | ---------- | ---- | ---------- |
|     |     | politicians |     | use can       | incite  | violence | and      | undermine |        | democracy. |      | "Trump’s   |
|     |     | words       | are | an incitement | to      | the type | of       | political |        | violence   | that | touched    |
me personally," Rabin wrote in USAToday. He said that Trump’s appeal to
|     |     | "Second | Amendment | people" |     | to stop | Hillary | Clinton |     | -- comments |     | that were |
| --- | --- | ------- | --------- | ------- | --- | ------- | ------- | ------- | --- | ----------- | --- | --------- |
criticized as a call for violence against Clinton, something Trump denied
|     |     | -- "were | a   | new level | of ugliness |     | in an | ugly | campaign | season." |     |     |
| --- | --- | -------- | --- | --------- | ----------- | --- | ----- | ---- | -------- | -------- | --- | --- |
- The son of a former Israeli Prime Minister who was assassinated wrote an
|     |     | op ed   | about | the consequence |         | of violent |     | political |       | rhetoric. |          |        |
| --- | --- | ------- | ----- | --------------- | ------- | ---------- | --- | --------- | ----- | --------- | -------- | ------ |
|     |     | - Warns | of    | "parallels"     | between | Israel     |     | of the    | 1990s | and       | the U.S. | today. |
Correct Answer → - Referencing his father, who was shot and killed by an extremist amid
|     |     | political  |     | tension in | Israel | in 1995, |     | Rabin | condemned | Donald |     | Trump’s |
| --- | --- | ---------- | --- | ---------- | ------ | -------- | --- | ----- | --------- | ------ | --- | ------- |
|     |     | aggressive |     | rhetoric.  |        |          |     |       |           |        |     |         |
Correct Answer → - Referencing his father, who was shot and killed by an extremist amid
|     |     | political |     | tension in | Israel | in 1995, |     | Rabin | condemned | Trump’s |     | aggressive |
| --- | --- | --------- | --- | ---------- | ------ | -------- | --- | ----- | --------- | ------- | --- | ---------- |
rhetoric.
Incorrect Answer → - Referencing his father, who was shot and killed by an extremist amid
|     |     | political  |     | tension in | Israel | in 1995, |     | Rabin | condemned | Hillary |     | Clinton’s |
| --- | --- | ---------- | --- | ---------- | ------ | -------- | --- | ----- | --------- | ------- | --- | --------- |
|     |     | aggressive |     | rhetoric.  |        |          |     |       |           |         |     |           |
Incorrect Answer → - Referencing his father, who was shot and killed by an extremist amid
|     |     | political |     | tension in | Israel | in 1995, |     | Rabin | condemned | U.S.’s |     | aggressive |
| --- | --- | --------- | --- | ---------- | ------ | -------- | --- | ----- | --------- | ------ | --- | ---------- |
rhetoric.
Incorrect Answer → - Referencing his father, who was shot and killed by an extremist amid
|     |     | political  |     | tension in | Israel | in 1995, |     | Rabin | condemned | Yitzhak |     | Rabin’s |
| --- | --- | ---------- | --- | ---------- | ------ | -------- | --- | ----- | --------- | ------- | --- | ------- |
|     |     | aggressive |     | rhetoric.  |        |          |     |       |           |         |     |         |
FigureG.6: FormatteddatasetexampleforReCoRD.Weconsiderthecontextabovetobeasingle”problem”because
thisishowthetaskispresentedintheReCoRDdatasetandscoredintheReCoRDevaluationscript.
Context → anli 1: anli 1: Fulton James MacGregor MSP is a Scottish politician
|     |     | who | is a Scottish | National |     | Party | (SNP) | Member | of  | Scottish | Parliament |     |
| --- | --- | --- | ------------- | -------- | --- | ----- | ----- | ------ | --- | -------- | ---------- | --- |
for the constituency of Coatbridge and Chryston. MacGregor is currently
|     |     | Parliamentary |          | Liaison         | Officer | to          | Shona  | Robison, | Cabinet |           | Secretary | for      |
| --- | --- | ------------- | -------- | --------------- | ------- | ----------- | ------ | -------- | ------- | --------- | --------- | -------- |
|     |     | Health        | & Sport. | He              | also    | serves      | on the | Justice  | and     | Education |           | & Skills |
|     |     | committees    |          | in the Scottish |         | Parliament. |        |          |         |           |           |          |
Question: Fulton James MacGregor is a Scottish politican who is a Liaison
officer to Shona Robison who he swears is his best friend. True, False, or
Neither?
| Correct   | Answer | → Neither |     |     |     |     |     |     |     |     |     |     |
| --------- | ------ | --------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Incorrect | Answer | → True    |     |     |     |     |     |     |     |     |     |     |
| Incorrect | Answer | → False   |     |     |     |     |     |     |     |     |     |     |
FigureG.7: FormatteddatasetexampleforANLIR1
52

|           | Context | → Organisms |               | require  | energy | in  | order to do | what? |     |
| --------- | ------- | ----------- | ------------- | -------- | ------ | --- | ----------- | ----- | --- |
| Correct   | Answer  | → mature    | and           | develop. |        |     |             |       |     |
| Incorrect | Answer  | → rest      | soundly.      |          |        |     |             |       |     |
| Incorrect | Answer  | → absorb    | light.        |          |        |     |             |       |     |
| Incorrect | Answer  | → take      | in nutrients. |          |        |     |             |       |     |
Figure G.8: Formatted dataset example for OpenBookQA. When predicting, we normalize by the unconditional
probabilityofeachanswerasdescribedin2.
Context → Making a cake: Several cake pops are shown on a display. A woman and girl
|           |        | are     | shown        | making                              | the cake   | pops          | in a kitchen. |          | They |
| --------- | ------ | ------- | ------------ | ----------------------------------- | ---------- | ------------- | ------------- | -------- | ---- |
| Correct   | Answer | → bake  | them,        | then                                | frost      | and decorate. |               |          |      |
| Incorrect | Answer | → taste | them         | as they                             | place      | them          | on plates.    |          |      |
| Incorrect | Answer | → put   | the frosting |                                     | on the     | cake          | as they pan   | it.      |      |
| Incorrect | Answer | → come  | out          | and begin                           | decorating |               | the cake      | as well. |      |
|           |        |         | FigureG.9:   | FormatteddatasetexampleforHellaSwag |            |               |               |          |      |
Context → anli 3: anli 3: We shut the loophole which has American workers actually
subsidizing the loss of their own job. They just passed an expansion of
$43
that loophole in the last few days: billion of giveaways, including
favors to the oil and gas industry and the people importing ceiling fans
|           |        | from      | China.      |              |                                  |        |            |        |             |
| --------- | ------ | --------- | ----------- | ------------ | -------------------------------- | ------ | ---------- | ------ | ----------- |
|           |        | Question: |             | The loophole |                                  | is now | gone True, | False, | or Neither? |
| Correct   | Answer | → False   |             |              |                                  |        |            |        |             |
| Incorrect | Answer | → True    |             |              |                                  |        |            |        |             |
| Incorrect | Answer | → Neither |             |              |                                  |        |            |        |             |
|           |        |           | FigureG.10: |              | FormatteddatasetexampleforANLIR3 |        |            |        |             |
Context → Question: George wants to warm his hands quickly by rubbing them. Which
|     |     | skin | surface | will | produce | the | most heat? |     |     |
| --- | --- | ---- | ------- | ---- | ------- | --- | ---------- | --- | --- |
Answer:
| Correct   | Answer | → dry   | palms   |      |        |     |     |     |     |
| --------- | ------ | ------- | ------- | ---- | ------ | --- | --- | --- | --- |
| Incorrect | Answer | → wet   | palms   |      |        |     |     |     |     |
| Incorrect | Answer | → palms | covered | with | oil    |     |     |     |     |
| Incorrect | Answer | → palms | covered | with | lotion |     |     |     |     |
FigureG.11: FormatteddatasetexampleforARC(Challenge). Whenpredicting,wenormalizebytheunconditional
probabilityofeachanswerasdescribedin2.
|           | Context | → lull      | is to | trust                                  | as  |     |     |     |     |
| --------- | ------- | ----------- | ----- | -------------------------------------- | --- | --- | --- | --- | --- |
| Correct   | Answer  | → cajole    | is    | to compliance                          |     |     |     |     |     |
| Incorrect | Answer  | → balk      | is to | fortitude                              |     |     |     |     |     |
| Incorrect | Answer  | → betray    | is    | to loyalty                             |     |     |     |     |     |
| Incorrect | Answer  | → hinder    | is    | to destination                         |     |     |     |     |     |
| Incorrect | Answer  | → soothe    | is    | to passion                             |     |     |     |     |     |
|           |         | FigureG.12: |       | FormatteddatasetexampleforSATAnalogies |     |     |     |     |     |
Correct Context → Grace was happy to trade me her sweater for my jacket. She thinks the
sweater
Incorrect Context → Grace was happy to trade me her sweater for my jacket. She thinks the
jacket
| Target | Completion | → looks | dowdy | on  | her. |     |     |     |     |
| ------ | ---------- | ------- | ----- | --- | ---- | --- | --- | --- | --- |
FigureG.13:FormatteddatasetexampleforWinograd.The‘partial’evaluationmethodweusecomparestheprobability
ofthecompletiongivenacorrectandincorrectcontext.
53

Correct Context → Johnny likes fruits more than vegetables in his new keto diet because the
fruits
Incorrect Context → Johnny likes fruits more than vegetables in his new keto diet because the
vegetables
| Target | Completion | → are | saccharine. |     |     |     |     |     |     |     |     |     |
| ------ | ---------- | ----- | ----------- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
Figure G.14: Formatted dataset example for Winogrande. The ‘partial’ evaluation method we use compares the
probabilityofthecompletiongivenacorrectandincorrectcontext.
|     | Context | → READING    | COMPREHENSION |            | ANSWER   |              | KEY       |               |              |                  |               |         |
| --- | ------- | ------------ | ------------- | ---------- | -------- | ------------ | --------- | ------------- | ------------ | ---------------- | ------------- | ------- |
|     |         | While        | this          | process    | moved    | along,       | diplomacy |               | continued    | its              | rounds.       | Direct  |
|     |         | pressure     | on            | the        | Taliban  | had proved   |           | unsuccessful. |              | As one           | NSC staff     | note    |
|     |         | put          | it, "Under    | the        | Taliban, | Afghanistan  |           | is            | not so       | much             | a state       | sponsor |
|     |         | of terrorism |               | as         | it is a  | state        | sponsored | by            | terrorists." |                  | In early      | 2000,   |
|     |         | the          | United        | States     | began    | a high-level |           | effort        | to persuade  |                  | Pakistan      | to use  |
|     |         | its          | influence     | over       | the      | Taliban.     | In        | January       | 2000,        | Assistant        | Secretary     |         |
|     |         | of State     | Karl          | Inderfurth |          | and          | the State | Department’s  |              | counterterrorism |               |         |
|     |         | coordinator, |               | Michael    | Sheehan, |              | met with  | General       | Musharraf    |                  | in Islamabad, |         |
dangling before him the possibility of a presidential visit in March as a
reward for Pakistani cooperation. Such a visit was coveted by Musharraf,
partly as a sign of his government’s legitimacy. He told the two envoys
|     |     | that | he would | meet | with | Mullah | Omar | and press | him | on Bin | Laden. | They |
| --- | --- | ---- | -------- | ---- | ---- | ------ | ---- | --------- | --- | ------ | ------ | ---- |
left, however, reporting to Washington that Pakistan was unlikely in fact
|     |     | to do            | anything," |            | given     | what it  | sees      | as the        | benefits  | of        | Taliban         | control |
| --- | --- | ---------------- | ---------- | ---------- | --------- | -------- | --------- | ------------- | --------- | --------- | --------------- | ------- |
|     |     | of Afghanistan." |            |            | President | Clinton  |           | was scheduled |           | to travel | to India.       |         |
|     |     | The              | State      | Department | felt      | that     | he should |               | not visit | India     | without         | also    |
|     |     | visiting         | Pakistan.  |            | The       | Secret   | Service   | and           | the CIA,  | however,  | warned          | in      |
|     |     | the              | strongest  | terms      | that      | visiting | Pakistan  |               | would     | risk      | the President’s |         |
life. Counterterrorism officials also argued that Pakistan had not done
|     |     | enough       | to          | merit    | a presidential |                | visit.      | But     | President | Clinton   | insisted         |        |
| --- | --- | ------------ | ----------- | -------- | -------------- | -------------- | ----------- | ------- | --------- | --------- | ---------------- | ------ |
|     |     | on including |             | Pakistan | in             | the            | itinerary   | for     | his trip  | to        | South Asia.      | His    |
|     |     | one-day      | stopover    |          | on March       | 25,            | 2000,       | was the | first     | time      | a U.S. president |        |
|     |     | had          | been there  | since    | 1969.          | At             | his         | meeting | with      | Musharraf | and others,      |        |
|     |     | President    |             | Clinton  | concentrated   |                | on tensions |         | between   | Pakistan  | and              | India  |
|     |     | and          | the dangers |          | of nuclear     | proliferation, |             |         | but also  | discussed | Bin              | Laden. |
President Clinton told us that when he pulled Musharraf aside for a brief,
|     |     | one-on-one |     | meeting, | he  | pleaded | with | the general |     | for help | regarding | Bin |
| --- | --- | ---------- | --- | -------- | --- | ------- | ---- | ----------- | --- | -------- | --------- | --- |
Laden." I offered him the moon when I went to see him, in terms of better
relations with the United States, if he’d help us get Bin Laden and deal
|     |     | with | another | issue | or two."   | The | U.S.        | effort | continued. |       |               |     |
| --- | --- | ---- | ------- | ----- | ---------- | --- | ----------- | ------ | ---------- | ----- | ------------- | --- |
|     |     | Who  | did The | State | Department |     | feel should |        | visit both | India | and Pakistan? |     |
→
| Correct | Answer | - [False] |     | Bin Laden |     |     |     |     |     |     |     |     |
| ------- | ------ | --------- | --- | --------- | --- | --- | --- | --- | --- | --- | --- | --- |
→
| Incorrect | Answer | - [True] | Bin | Laden |     |     |     |     |     |     |     |     |
| --------- | ------ | -------- | --- | ----- | --- | --- | --- | --- | --- | --- | --- | --- |
FigureG.15: FormatteddatasetexampleforMultiRC.TherearethreelevelswithinMultiRC:(1)thepassage,(2)the
questions,and(3)theanswers. Duringevaluation,accuracyisdeterminedattheper-questionlevel,withaquestion
beingconsideredcorrectifandonlyifalltheanswerswithinthequestionarelabeledcorrectly. Forthisreason,weuse
K torefertothenumberofquestionsshownwithinthecontext.
Context → Question: Which factor will most likely cause a person to develop a fever?
Answer:
| Correct   | Answer | → a bacterial   |        | population |          | in the   | bloodstream |         |     |     |     |     |
| --------- | ------ | --------------- | ------ | ---------- | -------- | -------- | ----------- | ------- | --- | --- | --- | --- |
| Incorrect | Answer | → a leg         | muscle | relaxing   | after    | exercise |             |         |     |     |     |     |
| Incorrect | Answer | → several       | viral  | particles  |          | on the   | skin        |         |     |     |     |     |
| Incorrect | Answer | → carbohydrates |        | being      | digested |          | in the      | stomach |     |     |     |     |
Figure G.16: Formatted dataset example for ARC (Easy). When predicting, we normalize by the unconditional
probabilityofeachanswerasdescribedin2.
54

Context → Bob went to the gas station to fill up his car. His tank was completely
empty and so was his wallet. The cashier offered to pay for his gas if he
|     |     | came back | later | to pay. | Bob | felt | grateful | as he | drove | home. |     |     |
| --- | --- | --------- | ----- | ------- | --- | ---- | -------- | ----- | ----- | ----- | --- | --- |
Correct Answer → Bob believed that there were good people in the world.
| Incorrect Answer | →   | Bob contemplated |     | how                                  | unfriendly | the | world | was. |     |     |     |     |
| ---------------- | --- | ---------------- | --- | ------------------------------------ | ---------- | --- | ----- | ---- | --- | --- | --- | --- |
|                  |     | FigureG.17:      |     | FormatteddatasetexampleforStoryCloze |            |     |       |      |     |     |     |     |
Context → Helsinki is the capital and largest city of Finland. It is in the region
|     |     | of Uusimaa, | in  | southern | Finland, |     | on the | shore of | the | Gulf of | Finland. |     |
| --- | --- | ----------- | --- | -------- | -------- | --- | ------ | -------- | --- | ------- | -------- | --- |
Helsinki has a population of , an urban population of , and a metropolitan
population of over 1.4 million, making it the most populous municipality
|     |     | and urban | area | in Finland. |     | Helsinki | is  | some north | of  | Tallinn, | Estonia, |     |
| --- | --- | --------- | ---- | ----------- | --- | -------- | --- | ---------- | --- | -------- | -------- | --- |
east of Stockholm, Sweden, and west of Saint Petersburg, Russia. Helsinki
|     |     | has close | historical |     | connections |     | with these | three | cities. |     |     |     |
| --- | --- | --------- | ---------- | --- | ----------- | --- | ---------- | ----- | ------- | --- | --- | --- |
The Helsinki metropolitan area includes the urban core of Helsinki, Espoo,
|     |     | Vantaa,         | Kauniainen, |         | and surrounding |           | commuter | towns.  |            | It is        | the world’s |        |
| --- | --- | --------------- | ----------- | ------- | --------------- | --------- | -------- | ------- | ---------- | ------------ | ----------- | ------ |
|     |     | northernmost    | metro       | area    | of              | over one  | million  | people, | and        | the          | city        | is the |
|     |     | northernmost    | capital     |         | of an           | EU member | state.   | The     | Helsinki   | metropolitan |             |        |
|     |     | area is         | the third   | largest | metropolitan    |           | area     | in      | the Nordic | countries    |             |        |
|     |     | after Stockholm |             | and     | Copenhagen,     | and       | the      | City of | Helsinki   | is           | the third   |        |
largest after Stockholm and Oslo. Helsinki is Finland’s major political,
|     |     | educational, | financial, |       | cultural, |     | and research  |     | center | as well | as        | one of |
| --- | --- | ------------ | ---------- | ----- | --------- | --- | ------------- | --- | ------ | ------- | --------- | ------ |
|     |     | northern     | Europe’s   | major | cities.   |     | Approximately |     | 75% of | foreign | companies |        |
that operate in Finland have settled in the Helsinki region. The nearby
municipality of Vantaa is the location of Helsinki Airport, with frequent
|     |     | service | to various | destinations |          | in           | Europe | and Asia.   |     |     |     |     |
| --- | --- | ------- | ---------- | ------------ | -------- | ------------ | ------ | ----------- | --- | --- | --- | --- |
|     |     | Q: what | is the     | most         | populous | municipality |        | in Finland? |     |     |     |     |
A: Helsinki
|     |     | Q: how  | many people | live   | there?       |           |      |              |     |            |     |        |
| --- | --- | ------- | ----------- | ------ | ------------ | --------- | ---- | ------------ | --- | ---------- | --- | ------ |
|     |     | A: 1.4  | million     | in the | metropolitan |           | area |              |     |            |     |        |
|     |     | Q: what | percent     | of the | foreign      | companies |      | that operate |     | in Finland |     | are in |
Helsinki?
A: 75%
|     |     | Q: what | towns | are a | part of | the metropolitan |     | area? |     |     |     |     |
| --- | --- | ------- | ----- | ----- | ------- | ---------------- | --- | ----- | --- | --- | --- | --- |
A:
Target Completion → Helsinki, Espoo, Vantaa, Kauniainen, and surrounding commuter towns
|     |     | FigureG.18: |     | FormatteddatasetexampleforCoQA |     |     |     |     |     |     |     |     |
| --- | --- | ----------- | --- | ------------------------------ | --- | --- | --- | --- | --- | --- | --- | --- |
Context → Please unscramble the letters into a word, and write that word:
|                   |     | asinoc      | =                                       |     |     |     |     |     |     |     |     |     |
| ----------------- | --- | ----------- | --------------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Target Completion | →   | casino      |                                         |     |     |     |     |     |     |     |     |     |
|                   |     | FigureG.19: | FormatteddatasetexampleforCycledLetters |     |     |     |     |     |     |     |     |     |
55

Context → Passage: Saint Jean de Br´ebeuf was a French Jesuit missionary who
travelled to New France in 1625. There he worked primarily with the Huron
|     | for the | rest of    | his life, | except   | for a few    | years   | in France from | 1629 to |
| --- | ------- | ---------- | --------- | -------- | ------------ | ------- | -------------- | ------- |
|     | 1633.   | He learned | their     | language | and culture, | writing | extensively    | about   |
each to aid other missionaries. In 1649, Br´ebeuf and another missionary
were captured when an Iroquois raid took over a Huron village . Together
|     | with Huron | captives, | the | missionaries | were | ritually | tortured | and killed |
| --- | ---------- | --------- | --- | ------------ | ---- | -------- | -------- | ---------- |
on March 16, 1649. Br´ebeuf was beatified in 1925 and among eight Jesuit
|     | missionaries | canonized |            | as saints  | in the Roman | Catholic | Church  | in 1930.   |
| --- | ------------ | --------- | ---------- | ---------- | ------------ | -------- | ------- | ---------- |
|     | Question:    | How       | many years | did Saint  | Jean de      | Br´ebeuf | stay in | New France |
|     | before       | he went   | back to    | France for | a few years? |          |         |            |
Answer:
| Target Completion | → 4         |           |                                |               |     |     |     |     |
| ----------------- | ----------- | --------- | ------------------------------ | ------------- | --- | --- | --- | --- |
|                   | FigureG.20: |           | FormatteddatasetexampleforDROP |               |     |     |     |     |
| Context           | → Fill in   | blank:    |                                |               |     |     |     |     |
|                   | She held    | the torch | in                             | front of her. |     |     |     |     |
|                   | She caught  | her       | breath.                        |               |     |     |     |     |
|                   | "Chris?     | There’s   | a step."                       |               |     |     |     |     |
"What?"
|                   | "A step.    | Cut                               | in the rock. | About      | fifty feet | ahead." | She moved | faster. |
| ----------------- | ----------- | --------------------------------- | ------------ | ---------- | ---------- | ------- | --------- | ------- |
|                   | They both   | moved                             | faster.      | "In fact," | she said,  | raising | the torch | higher, |
|                   | "there’s    | more than                         | a            | . ->       |            |         |           |         |
| Target Completion | → step      |                                   |              |            |            |         |           |         |
|                   | FigureG.21: | FormatteddatasetexampleforLAMBADA |              |            |            |         |           |         |
Context → Please unscramble the letters into a word, and write that word:
skicts =
| Target Completion | → sticks    |                                         |     |     |     |     |     |     |
| ----------------- | ----------- | --------------------------------------- | --- | --- | --- | --- | --- | --- |
|                   | FigureG.22: | FormatteddatasetexampleforAnagrams1(A1) |     |     |     |     |     |     |
Context → Please unscramble the letters into a word, and write that word:
|                   | volwskagen   | =      |                                     |            |           |     |     |     |
| ----------------- | ------------ | ------ | ----------------------------------- | ---------- | --------- | --- | --- | --- |
| Target Completion | → volkswagen |        |                                     |            |           |     |     |     |
|                   | FigureG.23:  |        | FormatteddatasetexampleforAnagrams2 |            |           |     |     |     |
| Context           | → Q: Who     | played | tess on                             | touched by | an angel? |     |     |     |
A:
Target Completion → Delloreese Patricia Early (July 6, 1931 { November 19, 2017), known
|     | professionally |                                            | as Della | Reese |     |     |     |     |
| --- | -------------- | ------------------------------------------ | -------- | ----- | --- | --- | --- | --- |
|     | FigureG.24:    | FormatteddatasetexampleforNaturalQuestions |          |       |     |     |     |     |
56

Context → TITLE: William Perry (American football) - Professional career
|     | PARAGRAPH: | In  | 1985, | he was | selected | in  | the first | round | of  | the 1985 | NFL |
| --- | ---------- | --- | ----- | ------ | -------- | --- | --------- | ----- | --- | -------- | --- |
Draft by the Chicago Bears; he had been hand-picked by coach Mike Ditka.
|     | However,     | defensive |                | coordinator | Buddy     | Ryan,   | who       | had          | a highly  | acrimonious |        |
| --- | ------------ | --------- | -------------- | ----------- | --------- | ------- | --------- | ------------ | --------- | ----------- | ------ |
|     | relationship |           | with Ditka,    |             | called    | Perry   | a "wasted | draft-pick". |           | Perry       |        |
|     | soon became  | a         | pawn           | in the      | political | power   | struggle  |              | between   | Ditka       | and    |
|     | Ryan.        | Perry’s   | "Refrigerator" |             | nickname  |         | followed  | him          | into      | the NFL     | and he |
|     | quickly      | became    | a favorite     |             | of the    | Chicago | Bears     | fans.        | Teammates |             | called |
him "Biscuit," as in "one biscuit shy of 350 pounds." While Ryan refused
to play Perry, Ditka decided to use Perry as a fullback when the team was
|     | near the | opponents’ |     | goal | line or | in fourth | and | short | situations, |     | either |
| --- | -------- | ---------- | --- | ---- | ------- | --------- | --- | ----- | ----------- | --- | ------ |
as a ball carrier or a lead blocker for star running back Walter Payton.
|     | Ditka stated    |           | the inspiration |            | for        | using      | Perry    | as a     | fullback | came       | to him |
| --- | --------------- | --------- | --------------- | ---------- | ---------- | ---------- | -------- | -------- | -------- | ---------- | ------ |
|     | during          | five-yard | sprint          | exercises. |            | During     | his      | rookie   | season,  | Perry      |        |
|     | rushed          | for two   | touchdowns      |            | and caught | a          | pass     | for one. | Perry    | even       | had    |
|     | the opportunity |           | to              | run the    | ball       | during     | Super    | Bowl     | XX, as   | a nod to   | his    |
|     | popularity      | and       | contributions   |            | to         | the team’s | success. |          | The      | first time | he     |
got the ball, he was tackled for a one-yard loss while attempting to throw
his first NFL pass on a halfback option play. The second time he got the
ball, he scored a touchdown (running over Patriots linebacker Larry McGrew
|     | in the   | process). | About  | halfway |             | through | his         | rookie | season, | Ryan         | finally |
| --- | -------- | --------- | ------ | ------- | ----------- | ------- | ----------- | ------ | ------- | ------------ | ------- |
|     | began to | play      | Perry, | who     | soon proved | that    | he          | was a  | capable | defensive    |         |
|     | lineman. | His       | Super  | Bowl    | ring size   | is      | the largest |        | of any  | professional |         |
football player in the history of the event. His ring size is 25, while
the ring size for the average adult male is between 10 and 12. Perry went
on to play for ten years in the NFL, retiring after the 1994 season. In
|     | his ten    | years | as a        | pro, he | regularly   | struggled |        | with        | his    | weight,     | which |
| --- | ---------- | ----- | ----------- | ------- | ----------- | --------- | ------ | ----------- | ------ | ----------- | ----- |
|     | hampered   | his   | performance |         | at times.   | He        | played | in 138      | games, | recording   |       |
|     | 29.5 sacks | and   | five        | fumble  | recoveries, |           | which  | he returned |        | for a total | of    |
71 yards. In his offensive career he ran five yards for two touchdowns,
|     | and had | one reception |     | for | another | touchdown. |     | Perry | later | attempted | a   |
| --- | ------- | ------------- | --- | --- | ------- | ---------- | --- | ----- | ----- | --------- | --- |
comeback, playing an unremarkable 1996 season with the London Monarchs of
|     | the World | League | of     | American | Football |     | (later | NFL Europa). |     |     |     |
| --- | --------- | ------ | ------ | -------- | -------- | --- | ------ | ------------ | --- | --- | --- |
|     | Q: what   | team   | did he | play     | for?     |     |        |              |     |     |     |
A:
| Target Completion | → the Chicago | Bears |     |     |     |     |     |     |     |     |     |
| ----------------- | ------------- | ----- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
FigureG.25: FormatteddatasetexampleforQuAC
Context → Please unscramble the letters into a word, and write that word:
|                   | r e!c.i      | p r o.c                                   | a/l | =   |     |     |     |     |     |     |     |
| ----------------- | ------------ | ----------------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Target Completion | → reciprocal |                                           |     |     |     |     |     |     |     |     |     |
|                   | FigureG.26:  | FormatteddatasetexampleforSymbolInsertion |     |     |     |     |     |     |     |     |     |
Context → Please unscramble the letters into a word, and write that word:
|                   | taefed      | =                                       |     |     |     |     |     |     |     |     |     |
| ----------------- | ----------- | --------------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Target Completion | → defeat    |                                         |     |     |     |     |     |     |     |     |     |
|                   | FigureG.27: | FormatteddatasetexampleforReversedWords |     |     |     |     |     |     |     |     |     |
57

|     | Context | → Title: | The | Blitz |     |     |     |     |     |     |     |
| --- | ------- | -------- | --- | ----- | --- | --- | --- | --- | --- | --- | --- |
Background: From the German point of view, March 1941 saw an improvement.
|     |     | The   | Luftwaffe | flew     | 4,000 | sorties    | that month, | including   |     | 12      | major and |
| --- | --- | ----- | --------- | -------- | ----- | ---------- | ----------- | ----------- | --- | ------- | --------- |
|     |     | three | heavy     | attacks. | The   | electronic | war         | intensified |     | but the | Luftwaffe |
flew major inland missions only on moonlit nights. Ports were easier to
find and made better targets. To confuse the British, radio silence was
|     |     | observed | until   | the          | bombs | fell. X- | and Y-Ger¨at |         | beams | were  | placed over |
| --- | --- | -------- | ------- | ------------ | ----- | -------- | ------------ | ------- | ----- | ----- | ----------- |
|     |     | false    | targets | and switched |       | only at  | the last     | minute. |       | Rapid | frequency   |
changes were introduced for X-Ger¨at, whose wider band of frequencies and
greater tactical flexibility ensured it remained effective at a time when
|     |     | British | selective | jamming |      | was degrading |       | the effectiveness |     |     | of Y-Ger¨at. |
| --- | --- | ------- | --------- | ------- | ---- | ------------- | ----- | ----------------- | --- | --- | ------------ |
|     |     | Q: How  | many      | sorties | were | flown in      | March | 1941?             |     |     |              |
A: 4,000
|     |     | Q: When | did | the Luftwaffe |     | fly inland | missions? |     |     |     |     |
| --- | --- | ------- | --- | ------------- | --- | ---------- | --------- | --- | --- | --- | --- |
A:
| Target | Completion | → only      | on moonlit | nights                            |     |     |     |     |     |     |     |
| ------ | ---------- | ----------- | ---------- | --------------------------------- | --- | --- | --- | --- | --- | --- | --- |
|        |            | FigureG.28: |            | FormatteddatasetexampleforSQuADv2 |     |     |     |     |     |     |     |
Context → Normal force -- In a simple case such as an object resting upon a table,
the normal force on the object is equal but in opposite direction to the
gravitational force applied on the object (or the weight of the object),
|     |     | that | is, N | = m g (\displaystyle |     | N=mg), | where | m   | is mass, | and | g is the |
| --- | --- | ---- | ----- | -------------------- | --- | ------ | ----- | --- | -------- | --- | -------- |
gravitational field strength (about 9.81 m/s on Earth). The normal force
|     |     | here | represents | the | force | applied | by the | table | against | the | object that |
| --- | --- | ---- | ---------- | --- | ----- | ------- | ------ | ----- | ------- | --- | ----------- |
prevents it from sinking through the table and requires that the table is
sturdy enough to deliver this normal force without breaking. However, it
|     |     | is easy      | to    | assume that | the       | normal    | force    | and weight | are        | action-reaction |              |
| --- | --- | ------------ | ----- | ----------- | --------- | --------- | -------- | ---------- | ---------- | --------------- | ------------ |
|     |     | force        | pairs | (a common   | mistake). |           | In this  | case,      | the normal |                 | force and    |
|     |     | weight       | need  | to be equal | in        | magnitude | to       | explain    | why        | there           | is no upward |
|     |     | acceleration |       | of the      | object.   | For       | example, | a ball     | that       | bounces         | upwards      |
accelerates upwards because the normal force acting on the ball is larger
|     |     | in magnitude |     | than the      | weight | of the      | ball. |           |     |          |     |
| --- | --- | ------------ | --- | ------------- | ------ | ----------- | ----- | --------- | --- | -------- | --- |
|     |     | question:    |     | is the normal |        | force equal | to    | the force | of  | gravity? |     |
answer:
| Target | Completion | → yes |             |                                 |     |     |     |     |     |     |     |
| ------ | ---------- | ----- | ----------- | ------------------------------- | --- | --- | --- | --- | --- | --- | --- |
|        |            |       | FigureG.29: | FormatteddatasetexampleforBoolQ |     |     |     |     |     |     |     |
Context → The trend toward lower rents may seem surprising given that some
|     |     | communities |     | in New  | York are | bemoaning    | the | loss       | of favorite |     | local    |
| --- | --- | ----------- | --- | ------- | -------- | ------------ | --- | ---------- | ----------- | --- | -------- |
|     |     | businesses  |     | to high | rents.   | But, despite |     | the recent | softening,  |     | for many |
of these retailers there’s still been too big a jump from the rental rates
of the late 1970s, when their leases were signed. Certainly, the recent
|     |     | drop      | in prices | doesn’t   | mean  | Manhattan | comes | cheap. |             |     |     |
| --- | --- | --------- | --------- | --------- | ----- | --------- | ----- | ------ | ----------- | --- | --- |
|     |     | question: |           | Manhattan | comes | cheap.    | true, | false, | or neither? |     |     |
answer:
| Target | Completion | → false |             |                              |     |     |     |     |     |     |     |
| ------ | ---------- | ------- | ----------- | ---------------------------- | --- | --- | --- | --- | --- | --- | --- |
|        |            |         | FigureG.30: | FormatteddatasetexampleforCB |     |     |     |     |     |     |     |
58

Context → The bet, which won him dinner for four, was regarding the existence and
|     |     | mass | of the | top | quark, | an elementary |     | particle |     | discovered | in 1995. |     |
| --- | --- | ---- | ------ | --- | ------ | ------------- | --- | -------- | --- | ---------- | -------- | --- |
question: The Top Quark is the last of six flavors of quarks predicted by
|     |     | the | standard | model | theory | of  | particle | physics. |     | True | or False? |     |
| --- | --- | --- | -------- | ----- | ------ | --- | -------- | -------- | --- | ---- | --------- | --- |
answer:
| Target | Completion | → False |             |          |                               |            |        |     |         |         |     |     |
| ------ | ---------- | ------- | ----------- | -------- | ----------------------------- | ---------- | ------ | --- | ------- | ------- | --- | --- |
|        |            |         | FigureG.31: |          | FormatteddatasetexampleforRTE |            |        |     |         |         |     |     |
|        | Context    | → An    | outfitter   | provided |                               | everything | needed |     | for the | safari. |     |     |
Before his first walking holiday, he went to a specialist outfitter to buy
|     |     | some      | boots. |        |      |             |     |      |        |          |        |     |
| --- | --- | --------- | ------ | ------ | ---- | ----------- | --- | ---- | ------ | -------- | ------ | --- |
|     |     | question: |        | Is the | word | ‘outfitter’ |     | used | in the | same way | in the | two |
|     |     | sentences |        | above? |      |             |     |      |        |          |        |     |
answer:
| Target | Completion | → no          |             |        |                               |           |      |     |           |           |     |          |
| ------ | ---------- | ------------- | ----------- | ------ | ----------------------------- | --------- | ---- | --- | --------- | --------- | --- | -------- |
|        |            |               | FigureG.32: |        | FormatteddatasetexampleforWiC |           |      |     |           |           |     |          |
|        | Context    | → Final       | Exam        | with   | Answer                        | Key       |      |     |           |           |     |          |
|        |            | Instructions: |             | Please |                               | carefully | read | the | following | passages. |     | For each |
passage, you must identify which noun the pronoun marked in *bold* refers
to.
=====
Passage: Mr. Moncrieff visited Chester’s luxurious New York apartment,
|     |     | thinking  |           | that it     | belonged | to        | his son   | Edward.  |           | The result | was        | that Mr. |
| --- | --- | --------- | --------- | ----------- | -------- | --------- | --------- | -------- | --------- | ---------- | ---------- | -------- |
|     |     | Moncrieff |           | has decided |          | to cancel | Edward’s  |          | allowance | on         | the ground | that     |
|     |     | he        | no longer | requires    |          | *his*     | financial | support. |           |            |            |          |
Question: In the passage above, what does the pronoun "*his*" refer to?
Answer:
| Target | Completion | → mr. | moncrieff   |     |                               |     |     |     |     |     |     |     |
| ------ | ---------- | ----- | ----------- | --- | ----------------------------- | --- | --- | --- | --- | --- | --- | --- |
|        |            |       | FigureG.33: |     | FormatteddatasetexampleforWSC |     |     |     |     |     |     |     |
Context → Q: ‘Nude Descending A Staircase’ is perhaps the most famous painting by
|     |     | which | 20th | century | artist? |     |     |     |     |     |     |     |
| --- | --- | ----- | ---- | ------- | ------- | --- | --- | --- | --- | --- | --- | --- |
A:
| Target | Completion | → MARCEL              | DUCHAMP |        |         |     |     |     |     |     |     |     |
| ------ | ---------- | --------------------- | ------- | ------ | ------- | --- | --- | --- | --- | --- | --- | --- |
| Target | Completion | → r mutt              |         |        |         |     |     |     |     |     |     |     |
| Target | Completion | → duchamp             |         |        |         |     |     |     |     |     |     |     |
| Target | Completion | → marcel              | duchamp |        |         |     |     |     |     |     |     |     |
| Target | Completion | → R.Mutt              |         |        |         |     |     |     |     |     |     |     |
| Target | Completion | → Marcel              | duChamp |        |         |     |     |     |     |     |     |     |
| Target | Completion | → Henri-Robert-Marcel |         |        | Duchamp |     |     |     |     |     |     |     |
| Target | Completion | → Marcel              | du      | Champ  |         |     |     |     |     |     |     |     |
| Target | Completion | → henri               | robert  | marcel | duchamp |     |     |     |     |     |     |     |
| Target | Completion | → Duchampian          |         |        |         |     |     |     |     |     |     |     |
| Target | Completion | → Duchamp             |         |        |         |     |     |     |     |     |     |     |
| Target | Completion | → duchampian          |         |        |         |     |     |     |     |     |     |     |
| Target | Completion | → marcel              | du      | champ  |         |     |     |     |     |     |     |     |
| Target | Completion | → Marcel              | Duchamp |        |         |     |     |     |     |     |     |     |
| Target | Completion | → MARCEL              | DUCHAMP |        |         |     |     |     |     |     |     |     |
FigureG.34: FormatteddatasetexampleforTriviaQA.TriviaQAallowsformultiplevalidcompletions.
59

|     | Context | → Q: | What school | did | burne hogarth |     | establish? |     |     |     |     |
| --- | ------- | ---- | ----------- | --- | ------------- | --- | ---------- | --- | --- | --- | --- |
A:
| Target | Completion | → School | of          | Visual Arts                     |     |     |     |     |     |     |     |
| ------ | ---------- | -------- | ----------- | ------------------------------- | --- | --- | --- | --- | --- | --- | --- |
|        |            |          | FigureG.35: | FormatteddatasetexampleforWebQA |     |     |     |     |     |     |     |
Context → Keinesfalls d¨urfen diese f¨ur den kommerziellen Gebrauch verwendet werden.
=
Target Completion → In no case may they be used for commercial purposes.
FigureG.36: FormatteddatasetexampleforDe→En. Thisistheformatforone-andfew-shotlearning,forthisand
otherlangaugetasks, theformatforzero-shotlearningis“Q:Whatisthe{language}translationof{sentence}A:
{translation}.”
|     | Context | → In | no case | may they | be used | for commercial |     | purposes. |     | =   |     |
| --- | ------- | ---- | ------- | -------- | ------- | -------------- | --- | --------- | --- | --- | --- |
Target Completion → Keinesfalls d¨urfen diese f¨ur den kommerziellen Gebrauch verwendet werden.
|     |     |     | FigureG.37: | FormatteddatasetexampleforEn→De |     |     |     |     |     |     |     |
| --- | --- | --- | ----------- | ------------------------------- | --- | --- | --- | --- | --- | --- | --- |
Context → Analysis of instar distributions of larval I. verticalis collected from
a series of ponds also indicated that males were in more advanced instars
|     |     | than | females. | =   |     |     |     |     |     |     |     |
| --- | --- | ---- | -------- | --- | --- | --- | --- | --- | --- | --- | --- |
Target Completion → L’analyse de la distribution de fr´equence des stades larvaires d’I.
|     |     | verticalis |             | dans une                        | s´erie d’´etangs |               | a ´egalement |         | d´emontr´e | que       | les larves |
| --- | --- | ---------- | ----------- | ------------------------------- | ---------------- | ------------- | ------------ | ------- | ---------- | --------- | ---------- |
|     |     | m^ales     | ´etaient    | `a des                          | stades           | plus avanc´es |              | que les | larves     | femelles. |            |
|     |     |            | FigureG.38: | FormatteddatasetexampleforEn→Fr |                  |               |              |         |            |           |            |
Context → L’analyse de la distribution de fr´equence des stades larvaires d’I.
|     |     | verticalis |          | dans une | s´erie d’´etangs |               | a ´egalement |         | d´emontr´e | que       | les larves |
| --- | --- | ---------- | -------- | -------- | ---------------- | ------------- | ------------ | ------- | ---------- | --------- | ---------- |
|     |     | m^ales     | ´etaient | `a des   | stades           | plus avanc´es |              | que les | larves     | femelles. | =          |
Target Completion → Analysis of instar distributions of larval I. verticalis collected from
a series of ponds also indicated that males were in more advanced instars
|     |     | than | females.    |                                 |     |     |     |     |     |     |     |
| --- | --- | ---- | ----------- | ------------------------------- | --- | --- | --- | --- | --- | --- | --- |
|     |     |      | FigureG.39: | FormatteddatasetexampleforFr→En |     |     |     |     |     |     |     |
Context → The truth is that you want, at any price, and against the wishes of the
|     |     | peoples     | of           | Europe, | to continue | the      | negotiations   |            | for     | Turkey’s | accession    |
| --- | --- | ----------- | ------------ | ------- | ----------- | -------- | -------------- | ---------- | ------- | -------- | ------------ |
|     |     | to          | the European | Union,  | despite     | Turkey’s |                | continuing | refusal |          | to recognise |
|     |     | Cyprus      | and          | despite | the fact    | that     | the democratic |            | reforms | are      | at a         |
|     |     | standstill. |              | =       |             |          |                |            |         |          |              |
Target Completion → Adev˘arul este c˘a v˘a dorit¸i, cu orice pret¸ ¸si ^ımpotriva dorint¸ei
|     |     | europenilor, |     | s˘a continuat¸i |     | negocierile |     | de aderare | a   | Turciei | la Uniunea |
| --- | --- | ------------ | --- | --------------- | --- | ----------- | --- | ---------- | --- | ------- | ---------- |
European˘a, ^ın ciuda refuzului continuu al Turciei de a recunoa¸ste Ciprul
¸si ^ın ciuda faptului c˘a reformele democratice au ajuns ^ıntr-un punct mort.
|     |     |     | FigureG.40: | FormatteddatasetexampleforEn→Ro |     |     |     |     |     |     |     |
| --- | --- | --- | ----------- | ------------------------------- | --- | --- | --- | --- | --- | --- | --- |
60

Context → Adev˘arul este c˘a v˘a dorit¸i, cu orice pret¸ ¸si ^ımpotriva dorint¸ei
|     | europenilor, | s˘a continuat¸i | negocierile | de aderare | a Turciei | la Uniunea |
| --- | ------------ | --------------- | ----------- | ---------- | --------- | ---------- |
European˘a, ^ın ciuda refuzului continuu al Turciei de a recunoa¸ste Ciprul
¸si ^ın ciuda faptului c˘a reformele democratice au ajuns ^ıntr-un punct mort.
=
Target Completion → The truth is that you want, at any price, and against the wishes of the
|     | peoples | of Europe,      | to continue   | the negotiations    | for Turkey’s | accession    |
| --- | ------- | --------------- | ------------- | ------------------- | ------------ | ------------ |
|     | to the  | European Union, | despite       | Turkey’s continuing | refusal      | to recognise |
|     | Cyprus  | and despite     | the fact that | the democratic      | reforms      | are at a     |
standstill.
|           | FigureG.41: | FormatteddatasetexampleforRo→En |      |     |     |     |
| --------- | ----------- | ------------------------------- | ---- | --- | --- | --- |
| Context → | Q: What     | is (2 * 4)                      | * 6? |     |     |     |
A:
| Target Completion → | 48          |                                         |     |     |     |     |
| ------------------- | ----------- | --------------------------------------- | --- | --- | --- | --- |
|                     | FigureG.42: | FormatteddatasetexampleforArithmetic1DC |     |     |     |     |
| Context →           | Q: What     | is 17 minus                             | 14? |     |     |     |
A:
| Target Completion → | 3           |                                         |     |     |     |     |
| ------------------- | ----------- | --------------------------------------- | --- | --- | --- | --- |
|                     | FigureG.43: | FormatteddatasetexampleforArithmetic2D- |     |     |     |     |
| Context →           | Q: What     | is 98 plus                              | 45? |     |     |     |
A:
| Target Completion → | 143         |                                         |     |     |     |     |
| ------------------- | ----------- | --------------------------------------- | --- | --- | --- | --- |
|                     | FigureG.44: | FormatteddatasetexampleforArithmetic2D+ |     |     |     |     |
| Context →           | Q: What     | is 95 times                             | 45? |     |     |     |
A:
| Target Completion → | 4275        |                                         |      |     |     |     |
| ------------------- | ----------- | --------------------------------------- | ---- | --- | --- | --- |
|                     | FigureG.45: | FormatteddatasetexampleforArithmetic2Dx |      |     |     |     |
| Context →           | Q: What     | is 509 minus                            | 488? |     |     |     |
A:
| Target Completion → | 21          |                                         |     |     |     |     |
| ------------------- | ----------- | --------------------------------------- | --- | --- | --- | --- |
|                     | FigureG.46: | FormatteddatasetexampleforArithmetic3D- |     |     |     |     |
→
| Context | Q: What | is 556 plus | 497? |     |     |     |
| ------- | ------- | ----------- | ---- | --- | --- | --- |
A:
→
| Target Completion | 1053        |                                         |       |     |     |     |
| ----------------- | ----------- | --------------------------------------- | ----- | --- | --- | --- |
|                   | FigureG.47: | FormatteddatasetexampleforArithmetic3D+ |       |     |     |     |
| Context →         | Q: What     | is 6209 minus                           | 3365? |     |     |     |
A:
| Target Completion → | 2844        |                                         |     |     |     |     |
| ------------------- | ----------- | --------------------------------------- | --- | --- | --- | --- |
|                     | FigureG.48: | FormatteddatasetexampleforArithmetic4D- |     |     |     |     |
61

| Context → | Q: What | is 9923 plus | 617? |
| --------- | ------- | ------------ | ---- |
A:
| Target Completion → | 10540       |                                         |        |
| ------------------- | ----------- | --------------------------------------- | ------ |
|                     | FigureG.49: | FormatteddatasetexampleforArithmetic4D+ |        |
| Context →           | Q: What     | is 40649 minus                          | 78746? |
A:
| Target Completion → | -38097      |                                         |        |
| ------------------- | ----------- | --------------------------------------- | ------ |
|                     | FigureG.50: | FormatteddatasetexampleforArithmetic5D− |        |
| Context →           | Q: What     | is 65360 plus                           | 16204? |
A:
| Target Completion → | 81564       |                                         |     |
| ------------------- | ----------- | --------------------------------------- | --- |
|                     | FigureG.51: | FormatteddatasetexampleforArithmetic5D+ |     |
62

H ResultsonAllTasksforAllModelSizes
Zero-Shot One-Shot Few-Shot
Fine-tune 175B
Name Metric Split SOTA K SmallMedLargeXL 2.7B6.7B13B175B SmallMedLargeXL 2.7B6.7B13B175B SmallMedLargeXL 2.7B6.7B13B175B(testserver)
HellaSwag acc dev 85.6 20 33.7 43.651.0 54.762.867.470.978.9 33.0 42.950.5 53.561.966.570.078.1 33.5 43.151.3 54.962.967.371.379.3
LAMBADA acc test 68.0 15 42.7 54.360.4 63.667.170.372.576.2 22.0 47.152.6 58.361.165.469.072.5 22.0 40.463.2 57.078.179.181.386.4
LAMBADA ppl test 8.63 15 18.6 9.096.53 5.444.604.003.563.00 165.011.68.29 6.465.534.614.063.35 165.027.66.63 7.452.892.562.561.92
StoryCloze acc test 91.8 70 63.3 68.572.4 73.477.277.779.583.2 62.3 68.772.3 74.277.378.779.784.7 62.3 70.273.9 76.180.281.283.087.7
NQs acc test 44.5 64 0.64 1.752.71 4.406.015.797.8414.6 1.19 3.074.79 5.438.739.7813.723.0 1.72 4.467.89 9.7213.217.021.029.9
TriviaQA acc dev 68.0 64 4.15 7.6114.0 19.731.338.741.864.3 4.19 12.920.5 26.535.944.451.368.0 6.96 16.326.5 32.142.351.657.571.2 71.2
WebQs acc test 45.5 64 1.77 3.204.33 4.637.927.738.2214.4 2.56 6.208.51 9.1514.515.119.025.3 5.46 12.615.9 19.624.827.733.541.5
Ro→En16 BLEU-mb test 39.9 64 2.08 2.713.09 3.1516.38.3420.219.9 0.55 15.423.0 26.330.633.235.638.6 1.25 20.725.8 29.233.134.837.039.5
Ro→En16 BLEU-sb test 64 2.39 3.083.49 3.5616.88.7520.820.9 0.65 15.923.6 26.831.334.236.740.0 1.40 21.326.6 30.134.336.238.441.3
En→Ro16 BLEU-mb test 38.5 64 2.14 2.652.53 2.503.464.245.3214.1 0.35 3.307.89 8.7213.215.117.320.6 1.25 5.909.33 10.714.316.318.021.0
En→Ro16 BLEU-sb test 64 2.61 3.113.07 3.094.265.316.4318.0 0.55 3.909.15 10.315.718.220.824.9 1.64 7.4010.9 12.917.219.621.825.8
Fr→En14 BLEU-mb test 35.0 64 1.81 2.533.47 3.1320.615.121.821.2 1.28 15.923.7 26.329.030.530.233.7 4.98 25.528.5 31.133.734.936.639.2
Fr→En14 BLEU-sb test 64 2.29 2.993.90 3.6021.215.522.421.9 1.50 16.324.4 27.030.031.631.435.6 5.30 26.229.5 32.235.136.438.341.4
En→Fr14 BLEU-mb test 45.6 64 1.74 2.162.73 2.1515.18.8212.025.2 0.49 8.0014.8 15.920.323.324.928.3 4.08 14.519.3 21.524.927.329.532.6
En→Fr14 BLEU-sb test 45.9 64 2.44 2.753.54 2.8219.311.415.331.3 0.81 10.018.2 19.324.728.330.134.1 5.31 18.023.6 26.130.333.335.539.9
De→En16 BLEU-mb test 40.2 64 2.06 2.873.41 3.6321.517.323.027.2 0.83 16.222.5 24.728.230.733.030.4 3.25 22.726.2 29.232.734.837.340.6
De→En16 BLEU-sb test 64 2.39 3.273.85 4.0422.518.224.428.6 0.93 17.123.4 25.829.231.934.532.1 3.60 23.827.5 30.534.136.539.143.0
En→De16 BLEU-mb test 41.2 64 1.70 2.272.31 2.4312.98.6610.424.6 0.50 7.0012.9 13.118.320.922.526.2 3.42 12.315.4 17.120.923.026.629.7
En→De16 BLEU-sb test 41.2 64 2.09 2.652.75 2.9213.79.3611.025.3 0.54 7.4013.4 13.418.821.723.327.3 3.78 12.916.1 17.721.724.127.730.9
Winograd acc test 93.8 7 66.3 72.974.7 76.982.485.787.988.3 63.4 68.572.9 76.982.484.686.189.7 63.4 67.473.6 76.984.385.482.488.6
Winogrande acc dev 84.6 50 52.0 52.157.4 58.762.364.567.970.2 51.3 53.058.3 59.161.765.866.973.2 51.3 52.657.5 59.162.667.470.077.7
PIQA acc dev 77.1 50 64.6 70.272.9 75.175.678.078.581.0 64.3 69.371.8 74.474.376.377.880.5 64.3 69.472.0 74.375.477.879.982.3 82.8
ARC(Challenge)acc test 78.5 50 26.6 29.531.8 35.538.041.443.751.4 25.5 30.231.6 36.438.441.543.153.2 25.5 28.432.3 36.739.543.744.851.5
ARC(Easy) acc test 92.0 50 43.6 46.553.0 53.858.260.263.868.8 42.7 48.254.6 55.960.362.666.871.2 42.7 51.058.1 59.162.165.869.170.1
OpenBookQA acc test 87.2 100 35.6 43.245.2 46.853.050.455.657.6 37.0 39.846.2 46.453.453.055.858.8 37.0 43.648.0 50.655.655.260.865.4
Quac f1 dev 74.4 5 21.2 26.831.0 30.134.736.138.441.5 21.1 26.931.9 32.337.439.040.643.4 21.6 27.632.9 34.238.239.940.944.3
RACE-h acc test 90.0 10 35.2 37.940.1 40.942.444.144.645.5 34.3 37.740.0 42.043.844.344.645.9 34.3 37.040.4 41.442.344.745.146.8
RACE-m acc test 93.1 10 42.1 47.252.1 52.354.754.456.758.4 42.3 47.351.7 55.256.154.756.957.4 42.3 47.052.7 53.055.655.458.158.1
SQuADv2 em dev 90.7 16 22.6 32.833.9 43.143.645.449.052.6 25.1 37.537.9 47.947.951.156.060.1 27.5 40.539.2 53.550.056.662.664.9
SQuADv2 f1 dev 93.0 16 28.3 40.241.4 50.351.052.756.359.5 30.1 43.644.1 54.054.157.161.865.4 32.1 45.544.9 58.755.962.167.769.8
CoQA f1 dev 90.7 5 34.5 55.061.8 65.371.172.876.381.5 30.6 52.161.6 66.171.875.177.984.0 31.1 52.062.7 66.873.277.379.985.0
DROP f1 dev 89.1 20 9.40 13.614.4 16.419.717.024.023.6 11.7 18.120.9 23.026.427.329.234.3 12.9 18.724.0 25.629.729.732.336.5
BoolQ acc dev 91.0 32 49.7 60.358.9 62.467.165.466.260.5 52.6 61.760.4 63.768.468.769.076.7 43.1 60.662.0 64.170.370.070.277.5 76.4
CB acc dev 96.9 32 0.00 32.18.93 19.619.628.619.646.4 55.4 53.653.6 48.257.133.955.464.3 42.9 58.953.6 69.667.960.766.182.1 75.6
CB f1 dev 93.9 32 0.00 29.311.4 17.422.425.120.342.8 60.1 39.845.6 37.545.728.544.652.5 26.1 40.432.6 48.345.744.646.057.2 52.0
Copa acc dev 94.8 32 66.0 68.073.0 77.076.080.084.091.0 62.0 64.066.0 74.076.082.086.087.0 67.0 64.072.0 77.083.083.086.092.0 92.0
RTE acc dev 92.5 32 47.7 49.848.4 56.046.655.262.863.5 53.1 47.349.5 49.554.954.956.370.4 52.3 48.446.9 50.956.349.560.672.9 69.0
WiC acc dev 76.1 32 0.00 0.000.00 0.000.000.000.000.00 50.0 50.350.3 49.249.450.350.048.6 49.8 55.053.0 53.051.653.151.155.3 49.4
WSC acc dev 93.8 32 59.6 56.765.4 61.566.360.664.465.4 58.7 58.760.6 62.566.360.666.369.2 58.7 60.654.8 49.062.567.375.075.0 80.1
MultiRC acc dev 62.3 32 4.72 9.6512.3 13.614.318.424.227.6 4.72 9.6512.3 13.614.318.424.227.6 6.09 11.816.8 20.824.723.825.032.5 30.5
MultiRC f1a dev 88.2 32 57.0 59.760.4 59.960.064.571.472.9 57.0 59.760.4 59.960.064.571.472.9 45.0 55.964.2 65.469.566.469.374.8 75.4
ReCoRD acc dev 92.5 32 70.8 78.582.1 84.186.288.689.090.2 69.8 77.080.7 83.085.988.088.890.2 69.8 77.281.3 83.186.687.988.989.0 90.2
ReCoRD f1 dev 93.3 32 71.9 79.282.8 85.287.389.590.491.0 70.7 77.881.6 83.986.888.889.791.2 70.7 77.982.1 84.087.588.889.890.1 91.1
SuperGLUE average dev 89.0 40.6 47.446.8 49.650.152.354.458.2 54.4 55.156.7 57.861.259.764.368.9 50.2 56.256.8 60.064.363.666.973.2 71.8
ANLIR1 acc test 73.8 50 33.4 34.233.4 33.434.232.333.234.6 32.1 31.631.9 34.630.631.632.732.0 32.1 32.530.9 32.533.533.133.336.8
ANLIR2 acc test 50.7 50 33.2 31.933.3 33.333.833.533.535.4 35.7 33.733.2 32.732.733.933.933.9 35.7 33.832.1 31.432.633.332.634.0
ANLIR3 acc test 48.3 50 33.6 34.033.8 33.435.334.834.434.5 35.0 32.633.0 33.934.133.132.535.1 35.0 34.435.1 36.032.733.934.540.2
2D+ acc n/a 50 0.70 0.650.70 0.851.102.5415.476.9 2.00 0.553.15 4.0012.119.673.099.6 2.00 4.103.50 4.508.9011.955.5100.0
2D- acc n/a 50 1.25 1.251.25 1.251.607.6012.658.0 1.15 0.951.45 1.953.8511.544.686.4 1.15 1.452.25 2.707.3513.652.498.9
3D+ acc n/a 50 0.10 0.100.05 0.100.100.251.4034.2 0.15 0.000.10 0.300.450.9515.465.5 0.15 0.450.30 0.550.750.908.4080.4
3D- acc n/a 50 0.05 0.050.05 0.050.050.451.3548.3 0.05 0.150.25 0.300.551.606.1578.7 0.05 0.100.15 0.350.651.059.2094.2
4D+ acc n/a 50 0.05 0.050.00 0.000.050.050.154.00 0.00 0.000.10 0.000.000.100.8014.0 0.00 0.050.05 0.000.150.150.4025.5
4D- acc n/a 50 0.00 0.000.00 0.000.000.000.107.50 0.00 0.000.00 0.000.050.000.5014.0 0.00 0.050.00 0.000.100.050.4026.8
5D+ acc n/a 50 0.00 0.000.00 0.000.000.000.000.65 0.00 0.000.00 0.000.000.000.053.45 0.00 0.000.00 0.000.000.000.059.30
5D- acc n/a 50 0.00 0.000.00 0.000.000.000.000.80 0.00 0.000.00 0.000.000.000.053.75 0.00 0.000.00 0.000.000.000.009.90
2Dx acc n/a 50 2.20 2.252.65 2.102.555.806.1519.8 1.35 2.353.35 2.354.759.1511.027.4 1.35 2.902.70 2.854.256.107.0529.2
1DC acc n/a 50 1.25 2.952.75 0.050.302.350.759.75 1.90 2.802.85 3.656.459.158.2014.3 1.70 2.153.90 5.756.207.609.9521.3
CycledLetters acc n/a 100 0.62 0.712.85 0.000.631.352.583.66 1.67 4.365.68 6.466.259.4115.121.7 4.63 9.2710.7 14.516.721.927.737.9
Anagrams1 acc n/a 100 0.10 0.140.40 0.000.270.691.162.28 0.21 0.611.12 1.271.602.723.728.62 0.50 1.272.13 3.053.815.498.3815.1
Anagrams2 acc n/a 100 0.81 1.212.69 0.011.713.754.538.91 1.19 2.624.70 4.776.9710.214.625.9 1.94 4.807.59 9.8712.618.925.639.7
SymbolInsertionacc n/a 100 0.00 0.000.10 0.000.050.420.898.26 0.03 0.050.57 1.181.673.466.6245.4 0.11 0.282.19 4.186.6111.027.367.2
ReversedWords acc n/a 100 0.00 0.010.01 0.010.020.030.030.09 0.02 0.010.01 0.000.050.070.110.48 0.00 0.050.00 0.170.240.300.420.44
SATAnalogies acc n/a 20 35.6 39.045.2 44.150.049.252.753.7 30.5 41.243.1 46.555.154.353.559.1 30.5 40.442.8 40.648.451.953.565.2
TableH.1: Scoresforeverytask,settingandmodelthatweinvestigateinthispaper.
63

FigureH.1: AllresultsforallSuperGLUEtasks.
FigureH.2: ResultsforSATtask. FigureH.3: AllresultsforallWinogradtasks.
64

FigureH.4: AllresultsforallArithmetictasks.
FigureH.5: AllresultsforallClozeandCompletiontasks.
65

FigureH.6: AllresultsforallCommonSenseReasoningtasks.
FigureH.7: AllresultsforallQAtasks.
FigureH.8: AllresultsforallReadingComprehensiontasks.
FigureH.9: AllresultsforallANLIrounds.
66

FigureH.10: AllresultsforallScrambletasks.
FigureH.11: AllresultsforallTranslationtasks.
67

References
[ADG+16] MarcinAndrychowicz,MishaDenil,SergioGomez,MatthewWHoffman,DavidPfau,TomSchaul,
BrendanShillingford,andNandoDeFreitas. Learningtolearnbygradientdescentbygradientdescent.
InAdvancesinneuralinformationprocessingsystems,pages3981–3989,2016.
[AI19] WeChatAI. Tr-mt(ensemble),December2019.
[AJF19] RoeeAharoni,MelvinJohnson,andOrhanFirat. Massivelymultilingualneuralmachinetranslation. In
Proceedingsofthe2019ConferenceoftheNorthAmericanChapteroftheAssociationforComputational
Linguistics: HumanLanguageTechnologies,Volume1(LongandShortPapers),2019.
[BBDIW20] SuLinBlodgett,SolonBarocas,HalDaume´ III,andHannaWallach. Language(technology)ispower:
Acriticalsurveyof“bias”innlp. arXivpreprintarXiv:2005.14050,2020.
[BCFL13] Jonathan Berant, Andrew Chou, Roy Frostig, and Percy Liang. Semantic parsing on freebase from
question-answerpairs. InProceedingsofthe2013conferenceonempiricalmethodsinnaturallanguage
processing,pages1533–1544,2013.
[BDD+09] LuisaBentivogli,IdoDagan,HoaTrangDang,DaniloGiampiccolo,andBernardoMagnini. Thefifth
PASCALrecognizingtextualentailmentchallenge. 2009.
[BES10] Stefano Baccianella, Andrea Esuli, and Fabrizio Sebastiani. Sentiwordnet 3.0: an enhanced lexical
resourceforsentimentanalysisandopinionmining. InLrec,volume10,pages2200–2204,2010.
[BHDD+06] RoyBarHaim,IdoDagan,BillDolan,LisaFerro,DaniloGiampiccolo,BernardoMagnini,andIdan
Szpektor. ThesecondPASCALrecognisingtextualentailmentchallenge. 2006.
[BHT+20] Yonatan Bisk, Ari Holtzman, Jesse Thomason, JacobAndreas, Yoshua Bengio, Joyce Chai, Mirella
Lapata,AngelikiLazaridou,JonathanMay,AleksandrNisnevich,etal. Experiencegroundslanguage.
arXivpreprintarXiv:2004.10151,2020.
[BLC13] YoshuaBengio,NicholasLe´onard,andAaronC.Courville. Estimatingorpropagatinggradientsthrough
stochasticneuronsforconditionalcomputation. Arxiv,2013.
[BZB+19] YonatanBisk,RowanZellers,RonanLeBras,JianfengGao,andYejinChoi. Piqa: Reasoningabout
physicalcommonsenseinnaturallanguage. arXivpreprintarXiv:1911.11641,2019.
[Car97] RichCaruana. Multitasklearning. Machinelearning,28(1),1997.
[CB78] SusanCareyandElsaBartlett.Acquiringasinglenewword.ProceedingsoftheStanfordChildLanguage
Conference,1978.
[CCE+18] Peter Clark, Isaac Cowhey, Oren Etzioni, Tushar Khot, Ashish Sabharwal, Carissa Schoenick, and
OyvindTafjord. Thinkyouhavesolvedquestionanswering? tryarc,theai2reasoningchallenge. ArXiv,
abs/1803.05457,2018.
[CGRS19] RewonChild,ScottGray,AlecRadford,andIlyaSutskever. Generatinglongsequenceswithsparse
transformers,2019.
[CHI+18] Eunsol Choi, He He, Mohit Iyyer, Mark Yatskar, Wen-tau Yih, Yejin Choi, Percy Liang, and Luke
Zettlemoyer. Quac: Questionansweringincontext. Arxiv,2018.
[CLC+19] ChristopherClark,KentonLee,Ming-WeiChang,TomKwiatkowski,MichaelCollins,andKristina
Toutanova. BoolQ: Exploring the surprising difficulty of natural yes/no questions. arXiv preprint
arXiv:1905.10044,2019.
[CLY+19] Yen-Chun Chen, Linjie Li, Licheng Yu, Ahmed El Kholy, Faisal Ahmed, Zhe Gan, Yu Cheng, and
JingjingLiu. Uniter: Learninguniversalimage-textrepresentations. arXivpreprintarXiv:1909.11740,
2019.
[Cra17] KateCrawford. Thetroublewithbias. NIPS2017Keynote,2017.
[DCLT18] Jacob Devlin, Ming-Wei Chang, Kenton Lee, and Kristina Toutanova. BERT: Pre-training of deep
bidirectionaltransformersforlanguageunderstanding. arXivpreprintarXiv:1810.04805,2018.
68

[DGM06] Ido Dagan, Oren Glickman, and Bernardo Magnini. The PASCAL recognising textual entailment
challenge. InMachinelearningchallenges.evaluatingpredictiveuncertainty,visualobjectclassification,
andrecognisingtextualentailment,pages177–190.Springer,2006.
[DGV+18] Mostafa Dehghani, Stephan Gouws, Oriol Vinyals, Jakob Uszkoreit, and Lukasz Kaiser. Universal
transformers. Arxiv,2018.
[DHKH14] NadirDurrani,BarryHaddow,PhilippKoehn,andKennethHeafield. Edinburgh’sphrase-basedmachine
translationsystemsforwmt-14.InProceedingsoftheNinthWorkshoponStatisticalMachineTranslation,
pages97–104,2014.
[DL15] AndrewM.DaiandQuocV.Le. Semi-supervisedsequencelearning. InAdvancesinneuralinformation
processingsystems,2015.
[DMST19] Marie-CatherineDeMarneffe,MandySimons,andJudithTonhauser. TheCommitmentBank: Investigat-
ingprojectioninnaturallyoccurringdiscourse. 2019. ToappearinproceedingsofSinnundBedeutung
23.Datacanbefoundathttps://github.com/mcdm/CommitmentBank/.
[DSC+16] YanDuan, JohnSchulman, XiChen, PeterL.Bartlett, IlyaSutskever, andPieterAbbeel. Rl2: Fast
reinforcementlearningviaslowreinforcementlearning. ArXiv,abs/1611.02779,2016.
[DWD+19] Dheeru Dua, Yizhong Wang, Pradeep Dasigi, Gabriel Stanovsky, Sameer Singh, and Matt Gardner.
Drop: Areadingcomprehensionbenchmarkrequiringdiscretereasoningoverparagraphs. arXivpreprint
arXiv:1903.00161,2019.
[DYY+19] ZihangDai,ZhilinYang,YimingYang,JaimeG.Carbonell,QuocV.Le,andRuslanSalakhutdinov.
Transformer-xl: Attentivelanguagemodelsbeyondafixed-lengthcontext. Arxiv,2019.
[EOAG18] SergeyEdunov,MyleOtt,MichaelAuli,andDavidGrangier. Understandingback-translationatscale.
arXivpreprintarXiv:1808.09381,2018.
[FAL17] ChelseaFinn,PieterAbbeel,andSergeyLevine. Model-agnosticmeta-learningforfastadaptationof
deepnetworks. ArXiv,abs/1703.03400,2017.
[Fyo00] YaroslavFyodorov. Anaturallogicinferencesystem,2000.
[GG19] HilaGonenandYoavGoldberg. Lipstickonapig: Debiasingmethodscoverupsystematicgenderbiases
inwordembeddingsbutdonotremovethem. arXivpreprintarXiv:1903.03862,2019.
[GLT+20] Kelvin Guu, Kenton Lee, Zora Tung, Panupong Pasupat, and Ming-Wei Chang. Realm: Retrieval-
augmentedlanguagemodelpre-training. arXivpreprintarXiv:2002.08909,2020.
[GMDD07] DaniloGiampiccolo,BernardoMagnini,IdoDagan,andBillDolan. ThethirdPASCALrecognizing
textualentailmentchallenge. InProceedingsoftheACL-PASCALworkshopontextualentailmentand
paraphrasing,pages1–9.AssociationforComputationalLinguistics,2007.
[Gra16] AlexGraves. Adaptivecomputationtimeforrecurrentneuralnetworks. Arxiv,2016.
[GSL+18] SuchinGururangan,SwabhaSwayamdipta,OmerLevy,RoySchwartz,SamuelRBowman,andNoahA
Smith. Annotationartifactsinnaturallanguageinferencedata. arXivpreprintarXiv:1803.02324,2018.
[GSR19] SebastianGehrmann,HendrikStrobelt,andAlexanderM.Rush. Gltr: Statisticaldetectionandvisualiza-
tionofgeneratedtext. arXivpreprintarXiv: 1906.04043,2019.
[GWC+18] JiataoGu,YongWang,YunChen,KyunghyunCho,andVictorOKLi. Meta-learningforlow-resource
neuralmachinetranslation. arXivpreprintarXiv:1808.08437,2018.
[HB20] DanielHernandezandTomBrown. Aiandefficiency,May2020.
[HBFC19] AriHoltzman,JanBuys,MaxwellForbes,andYejinChoi. Thecuriouscaseofneuraltextdegeneration.
CoRR,abs/1904.09751,2019.
[HLW+20] Dan Hendrycks, Xiaoyuan Liu, Eric Wallace, Adam Dziedzic, Rishabh Krishnan, and Dawn Song.
Pretrainedtransformersimproveoutofdistributionrobustness. arXivpreprintarXiv:2004.06100,2020.
69

[HNA+17] JoelHestness,SharanNarang,NewshaArdalani,GregoryDiamos,HeewooJun,HassanKianinejad,Md.
MostofaAliPatwary,YangYang,andYanqiZhou. Deeplearningscalingispredictable,empirically.
arXivpreprintarXiv:1712.00409,2017.
[HR18] JeremyHowardandSebastianRuder. Universallanguagemodelfine-tuningfortextclassification. arXiv
preprintarXiv:1801.06146,2018.
[HVD15] GeoffreyHinton,OriolVinyals,andJeffDean. Distillingtheknowledgeinaneuralnetwork. arXiv
preprintarXiv:1503.02531,2015.
[HYC01] SeppHochreiter,AStevenYounger,andPeterRConwell. LearningtoLearnUsingGradientDescent.
InInternationalConferenceonArtificialNeuralNetworks,pages87–94.Springer,2001.
[HZJ+19] Po-Sen Huang, Huan Zhang, Ray Jiang, Robert Stanforth, Johannes Welbl, Jack Rae, Vishal Maini,
DaniYogatama,andPushmeetKohli. Reducingsentimentbiasinlanguagemodelsviacounterfactual
evaluation. arXivpreprintarXiv:1911.03064,2019.
[IBGC+14] MohitIyyer,JordanBoyd-Graber,LeonardoClaudino,RichardSocher,andHalDaume´ III. Aneural
networkforfactoidquestionansweringoverparagraphs. InEmpiricalMethodsinNaturalLanguage
Processing,2014.
[IDCBE19] DaphneIppolito,DanielDuckworth,ChrisCallison-Burch,andDouglasEck. Automaticdetectionof
generatedtextiseasiestwhenhumansarefooled. arXivpreprintarXiv:1911.00650,2019.
[JCWZ17] MandarJoshi,EunsolChoi,DanielS.Weld,andLukeZettlemoyer. TriviaQA:Alargescaledistantly
supervisedchallengedatasetforreadingcomprehension. arXivpreprintarXiv:1705.03551,2017.
[JN20] ZhengJunyuanandGammaLabNYC. Numerictransformer-albert,March2020.
[JVS+16] RafalJozefowicz,OriolVinyals,MikeSchuster,NoamShazeer,andYonghuiWu. Exploringthelimits
oflanguagemodeling. arXivpreprintarXiv:1602.02410,2016.
[JYS+19] Xiaoqi Jiao, YichunYin, Lifeng Shang, Xin Jiang, Xiao Chen, Linlin Li, Fang Wang, and QunLiu.
TinyBERT:DistillingBERTfornaturallanguageunderstanding. arXivpreprintarXiv:1909.10351,2019.
[JZC+19] YingJu,FubangZhao,ShijieChen,BowenZheng,XuefengYang,andYunfengLiu. Technicalreporton
conversationalquestionanswering. arXivpreprintarXiv:1909.10772,2019.
[KCR+18] DanielKhashabi,SnigdhaChaturvedi,MichaelRoth,ShyamUpadhyay,andDanRoth. Lookingbeyond
thesurface: Achallengesetforreadingcomprehensionovermultiplesentences. InProceedingsofNorth
AmericanChapteroftheAssociationforComputationalLinguistics(NAACL),2018.
[KKS+20] DanielKhashabi,TusharKhot,AshishSabharwal,OyvindTafjord,PeterClark,andHannanehHajishirzi.
Unifiedqa: Crossingformatboundarieswithasingleqasystem. arXivpreprintarXiv:2005.00700,2020.
[KMB20] SarahE.Kreps,MilesMcCain,andMilesBrundage. Allthenewsthat’sfittofabricate: Ai-generated
textasatoolofmediamisinformation,2020.
[KMH+20] JaredKaplan,SamMcCandlish,TomHenighan,TomB.Brown,BenjaminChess,RewonChild,Scott
Gray,AlecRadford,JeffreyWu,andDarioAmodei. Scalinglawsforneurallanguagemodels,2020.
[KPR+19] TomKwiatkowski,JennimariaPalomaki,OliviaRedfield,MichaelCollins,AnkurParikh,ChrisAlberti,
DanielleEpstein,IlliaPolosukhin,MatthewKelcey,JacobDevlin,KentonLee,KristinaN.Toutanova,
LlionJones,Ming-WeiChang,AndrewDai,JakobUszkoreit,QuocLe,andSlavPetrov. Naturalques-
tions: abenchmarkforquestionansweringresearch. TransactionsoftheAssociationofComputational
Linguistics,2019.
[KR16] YoonKimandAlexanderM.Rush. Sequence-levelknowledgedistillation. Arxiv,2016.
[LB02] EdwardLoperandStevenBird. Nltk: Thenaturallanguagetoolkit,2002.
[LC19] Guillaume Lample and Alexis Conneau. Cross-lingual language model pretraining. arXiv preprint
arXiv:1901.07291,2019.
70

[LCG+19] ZhenzhongLan,MingdaChen,SebastianGoodman,KevinGimpel,PiyushSharma,andRaduSori-
cut. ALBERT:AliteBERTforself-supervisedlearningoflanguagerepresentations. arXivpreprint
arXiv:1909.11942,2019.
[LCH+20] XiaodongLiu,HaoCheng,PengchengHe,WeizhuChen,YuWang,HoifungPoon,andJianfengGao.
Adversarialtrainingforlargeneurallanguagemodels. arXivpreprintarXiv:2004.08994,2020.
[LDL19] ZhongyangLi,XiaoDing,andTingLiu. Storyendingpredictionbytransferablebert. arXivpreprint
arXiv:1905.07504,2019.
[LDM12] HectorLevesque,ErnestDavis,andLeoraMorgenstern. TheWinogradschemachallenge. InThirteenth
InternationalConferenceonthePrinciplesofKnowledgeRepresentationandReasoning,2012.
[LGG+20] YinhanLiu,JiataoGu,NamanGoyal,XianLi,SergeyEdunov,MarjanGhazvininejad,MikeLewis,and
LukeZettlemoyer. Multilingualdenoisingpre-trainingforneuralmachinetranslation. arXivpreprint
arXiv:2001.08210,2020.
[LGH+15] XiaodongLiu, JianfengGao, XiaodongHe, LiDeng, KevinDuh, andYe-YiWang. Representation
learningusingmulti-taskdeepneuralnetworksforsemanticclassificationandinformationretrieval. In
Proceedingsofthe2015ConferenceoftheNorthAmericanChapteroftheAssociationforComputational
Linguistics: HumanLanguageTechnologies,2015.
[LH17] Ilya Loshchilov and Frank Hutter. Decoupled weight decay regularization. arXiv preprint
arXiv:1711.05101,2017.
[LHCG19a] Xiaodong Liu, Pengcheng He, Weizhu Chen, and Jianfeng Gao. Improving multi-task deep neural
networksviaknowledgedistillationfornaturallanguageunderstanding.arXivpreprintarXiv:1904.09482,
2019.
[LHCG19b] XiaodongLiu,PengchengHe,WeizhuChen,andJianfengGao. Multi-taskdeepneuralnetworksfor
naturallanguageunderstanding. arXivpreprintarXiv:1901.11504,2019.
[Lin20] TalLinzen.Howcanweaccelerateprogresstowardshuman-likelinguisticgeneralization? arXivpreprint
arXiv:2005.00955,2020.
[LLG+19] MikeLewis,YinhanLiu,NamanGoyal,MarjanGhazvininejad,AbdelrahmanMohamed,OmerLevy,
VesStoyanov,andLukeZettlemoyer. Bart: Denoisingsequence-to-sequencepre-trainingfornatural
languagegeneration,translation,andcomprehension. arXivpreprintarXiv:1910.13461,2019.
[LM17] KeLiandJitendraMalik. Learningtooptimizeneuralnets. arXivpreprintarXiv:1703.00441,2017.
[LOG+19] YinhanLiu,MyleOtt,NamanGoyal,JingfeiDu,MandarJoshi,DanqiChen,OmerLevy,MikeLewis,
LukeZettlemoyer,andVeselinStoyanov. RoBERTa: ArobustlyoptimizedBERTpretrainingapproach.
arXivpreprintarXiv:1907.11692,2019.
[LPP+20] Patrick Lewis, Ethan Perez, Aleksandra Piktus, Fabio Petroni, Vladimir Karpukhin, Naman Goyal,
Heinrich Ku¨ttler, Mike Lewis, Wen-tau Yih, Tim Rockta¨schel, Sebastian Riedel, and Kiela Douwe.
Retrieval-augmentedgenerationforknowledge-intensivenlptasks. arXivpreprintarXiv:2005.11401,
2020.
[LSP+18] PeterJ.Liu,MohammadSaleh,EtiennePot,BenGoodrich,RyanSepassi,LukaszKaiser,andNoam
Shazeer. GeneratingWikipediabysummarizinglongsequences. arXivpreprintarXiv:1801.10198,2018.
[LWS+20] ZhuohanLi,EricWallace,ShengShen,KevinLin,KurtKeutzer,DanKlein,andJosephE.Gonzalez.
Trainlarge,thencompress: Rethinkingmodelsizeforefficienttrainingandinferenceoftransformers,
2020.
[LXL+17] Guokun Lai, Qizhe Xie, Hanxiao Liu, Yiming Yang, and Eduard Hovy. Race: Large-scale reading
comprehensiondatasetfromexaminations. arXivpreprintarXiv:1704.04683,2017.
[LYN+20] Sheng-ChiehLin,Jheng-HongYang,RodrigoNogueira,Ming-FengTsai,Chuan-JuWang,andJimmy
Lin. Tttttacklingwinograndeschemas. arXivpreprintarXiv:2003.08380,2020.
[Mac92] David.MacKay. Information-basedobjectivefunctionsforactivedataselection. NeuralComputation,
1992.
71

[MBXS17] BryanMcCann,JamesBradbury,CaimingXiong,andRichardSocher. Learnedintranslation: Con-
textualizedwordvectors. InAdvancesinNeuralInformationProcessingSystems,pages6294–6305,
2017.
[MCCD13] TomasMikolov,KaiChen,GregCorrado,andJeffreyDean. Efficientestimationofwordrepresentations
invectorspace. arXivpreprintarXiv:1301.3781,2013.
[MCH+16] NasrinMostafazadeh,NathanaelChambers,XiaodongHe,DeviParikh,DhruvBatra,LucyVanderwende,
PushmeetKohli, andJamesAllen. Acorpusandevaluationframeworkfordeeperunderstandingof
commonsensestories. arXivpreprintarXiv:1604.01696,2016.
[MCKS18] TodorMihaylov,PeterClark,TusharKhot,andAshishSabharwal.Canasuitofarmorconductelectricity?
anewdatasetforopenbookquestionanswering. ArXiv,abs/1809.02789,2018.
[MKAT18] Sam McCandlish, Jared Kaplan, Dario Amodei, and OpenAI Dota Team. An empirical model of
large-batchtraining,2018.
[MKM+94] MitchellMarcus,GraceKim,MaryAnnMarcinkiewicz,RobertMacIntyre,AnnBies,MarkFerguson,
Karen Katz, and Britta Schasberger. The penn treebank: annotating predicate argument structure.
In Proceedings of the workshop on Human Language Technology, pages 114–119. Association for
ComputationalLinguistics,1994.
[MKXS18] Bryan McCann, Nitish Shirish Keskar, Caiming Xiong, and Richard Socher. The natural language
decathlon: Multitasklearningasquestionanswering. arXivpreprintarXiv:1806.08730,2018.
[MPL19] RThomasMcCoy,ElliePavlick,andTalLinzen. Rightforthewrongreasons: Diagnosingsyntactic
heuristicsinnaturallanguageinference. arXivpreprintarXiv:1902.01007,2019.
[MWZ+18] MargaretMitchell,SimoneWu,AndrewZaldivar,ParkerBarnes,LucyVasserman,BenHutchinson,
ElenaSpitzer,InioluwaDeborahRaji,andTimnitGebru. Modelcardsformodelreporting,2018.
[NBR20] MoinNadeem,AnnaBethke,andSivaReddy. Stereoset: Measuringstereotypicalbiasinpretrained
languagemodels. arXivpreprintarXiv:2004.09456,2020.
[NK19] TimothyNivenandHung-YuKao.Probingneuralnetworkcomprehensionofnaturallanguagearguments.
arXivpreprintarXiv:1907.07355,2019.
[Nor09] PeterNorvig. Naturallanguagecorpusdata,2009.
[NvNvdG19] MalvinaNissim,RikvanNoord,andRobvanderGoot. Fairisbetterthansensational: Manistodoctor
aswomanistodoctor. arXivpreprintarXiv:1905.09866,2019.
[NWD+19] YixinNie,AdinaWilliams,EmilyDinan,MohitBansal,JasonWeston,andDouweKiela. Adversarial
nli: Anewbenchmarkfornaturallanguageunderstanding. arXivpreprintarXiv:1910.14599,2019.
[oR16] UniversityofRegensburg. Fascha,2016.
[PCC18] MohammadTaherPilehvarandJoseCamacho-Collados. WIC:10,000examplepairsforevaluating
context-sensitiverepresentations. arXivpreprintarXiv:1808.09121,2018.
[PFB18] JasonPhang,ThibaultFe´vry,andSamuelR.Bowman. SentenceencodersonSTILTs: Supplementary
trainingonintermediatelabeled-datatasks. arXivpreprintarXiv:1811.01088,2018.
[PHR+18] AdamPoliak,AparajitaHaldar,RachelRudinger,J.EdwardHu,ElliePavlick,AaronStevenWhite,and
BenjaminVanDurme.Collectingdiversenaturallanguageinferenceproblemsforsentencerepresentation
evaluation. InProceedingsofEMNLP,2018.
[PKL+16] DenisPaperno,Germa´nKruszewski,AngelikiLazaridou,QuanNgocPham,RaffaellaBernardi,Sandro
Pezzelle,MarcoBaroni,GemmaBoleda,andRaquelFerna´ndez. Thelambadadataset: Wordprediction
requiringabroaddiscoursecontext. arXivpreprintarXiv:1606.06031,2016.
[PNZtY18] MatthewE.Peters,MarkNeumann,LukeZettlemoyer,andWentauYih. Dissectingcontextualword
embeddings: Architectureandrepresentation,2018.
[Pos18] MattPost. AcallforclarityinreportingBLEUscores. arXivpreprintarXiv:1804.08771,2018.
72

[PSM14] Jeffrey Pennington, Richard Socher, and Christopher Manning. GloVe: Global vectors for word
representation. In Proceedings of the 2014 conference on empirical methods in natural language
processing(EMNLP),2014.
[QIA20] QIANXIN. Sa-netonalbert(ensemble),April2020.
[QMZH19] YusuQian,UrwaMuaz,BenZhang,andJaeWonHyun. Reducinggenderbiasinword-levellanguage
modelswithagender-equalizinglossfunction. arXivpreprintarXiv:1905.12801,2019.
[RBG11] MelissaRoemmele,CosminAdrianBejan,andAndrewSGordon. Choiceofplausiblealternatives: An
evaluationofcommonsensecausalreasoning. In2011AAAISpringSymposiumSeries,2011.
[RCM19] SivaReddy, DanqiChen, andChristopherDManning. Coqa: Aconversationalquestionanswering
challenge. TransactionsoftheAssociationforComputationalLinguistics,7:249–266,2019.
[RCP+17] Scott Reed, Yutian Chen, Thomas Paine, Aa¨ron van den Oord, SM Eslami, Danilo Rezende, Oriol
Vinyals,andNandodeFreitas. Few-shotautoregressivedensityestimation: Towardslearningtolearn
distributions. arXivpreprintarXiv:1710.10304,2017.
[RJL18] PranavRajpurkar,RobinJia,andPercyLiang. Knowwhatyoudon’tknow: Unanswerablequestionsfor
squad. arXivpreprintarXiv:1806.03822,2018.
[RL16] SachinRaviandHugoLarochelle. Optimizationasamodelforfew-shotlearning. ICLR2017(oral),
2016.
[RLL+19] QiuRan,YankaiLin,PengLi,JieZhou,andZhiyuanLiu. NumNet: Machinereadingcomprehension
withnumericalreasoning. InProceedingsofEMNLP,2019.
[RNLVD18] Rachel Rudinger, Jason Naradowsky, Brian Leonard, and Benjamin Van Durme. Gender bias in
coreferenceresolution. arXivpreprintarXiv:1804.09301,2018.
[RNSS18] AlecRadford,KarthikNarasimhan,TimSalimans,andIlyaSutskever.Improvinglanguageunderstanding
bygenerativepre-training,2018.
[Ros12] R.S.Ross. Guideforconductingriskassessments. NISTSpecialPublication,2012.
[RRBS19] JonathanS.Rosenfeld,AmirRosenfeld,YonatanBelinkov,andNirShavit. Aconstructivepredictionof
thegeneralizationerroracrossscales,2019.
[RRS20] AdamRoberts,ColinRaffel,andNoamShazeer. Howmuchknowledgecanyoupackintotheparameters
ofalanguagemodel? arXivpreprintarXiv:2002.08910,2020.
[RSR+19] ColinRaffel,NoamShazeer,AdamRoberts,KatherineLee,SharanNarang,MichaelMatena,Yanqi
Zhou, Wei Li, and Peter J. Liu. Exploring the limits of transfer learning with a unified text-to-text
transformer,2019.
[RWC+19] AlecRadford,JeffreyWu,RewonChild,DavidLuan,DarioAmodei,andIlyaSutskever. Language
modelsareunsupervisedmultitasklearners,2019.
[SBBC19] KeisukeSakaguchi,RonanLeBras,ChandraBhagavatula,andYejinChoi. Winogrande: Anadversarial
winogradschemachallengeatscale,2019.
[SBC+19] IreneSolaiman,MilesBrundage,JackClark,AmandaAskell,ArielHerbert-Voss,JeffWu,AlecRadford,
GretchenKrueger,JongWookKim,SarahKreps,MilesMcCain,AlexNewhouse,JasonBlazakis,Kris
McGuffie,andJasmineWang. Releasestrategiesandthesocialimpactsoflanguagemodels,2019.
[SCNP19] Emily Sheng, Kai-Wei Chang, Premkumar Natarajan, and Nanyun Peng. The woman worked as a
babysitter: Onbiasesinlanguagegeneration. arXivpreprintarXiv:1909.01326,2019.
[SDCW19] VictorSanh,LysandreDebut,JulienChaumond,andThomasWolf. DistilBERT,adistilledversionof
BERT:smaller,faster,cheaperandlighter. arXivpreprintarXiv:1910.01108,2019.
[SDSE19] RoySchwartz,JesseDodge,NoahA.Smith,andOrenEtzioni. GreenAI. CoRR,abs/1907.10597,2019.
[SHB15] RicoSennrich,BarryHaddow,andAlexandraBirch. Improvingneuralmachinetranslationmodelswith
monolingualdata. arXivpreprintarXiv:1511.06709,2015.
73

[SMM+17] NoamShazeer,AzaliaMirhoseini,KrzysztofMaziarz,AndyDavis,QuocLe,GeoffreyHinton,andJeff
Dean. Outrageouslylargeneuralnetworks: Thesparsely-gatedmixture-of-expertslayer. arXivpreprint
arXiv:1701.06538,2017.
[SPP+19] MohammadShoeybi,MostofaPatwary,RaulPuri,PatrickLeGresley,JaredCasper,andBryanCatanzaro.
Megatron-lm: Trainingmulti-billionparameterlanguagemodelsusingmodelparallelism,2019.
[SS20] TimoSchickandHinrichSchu¨tze. Exploitingclozequestionsforfew-shottextclassificationandnatural
languageinference. arXivpreprintarXiv:2001.07676,2020.
[STQ+19] KaitaoSong,XuTan,TaoQin,JianfengLu,andTie-YanLiu. MASS:Maskedsequencetosequence
pre-trainingforlanguagegeneration. arXivpreprintarXiv:1905.02450,2019.
[TFR+17] JoshTobin,RachelFong,AlexRay,JonasSchneider,WojciechZaremba,andPieterAbbeel. Domain
randomizationfortransferringdeepneuralnetworksfromsimulationtotherealworld.In2017IEEE/RSJ
internationalconferenceonintelligentrobotsandsystems(IROS),pages23–30.IEEE,2017.
[TL05] PeterD.TurneyandMichaelL.Littman. Corpus-basedlearningofanalogiesandsemanticrelations.
CoRR,abs/cs/0508103,2005.
[TL18] Trieu H. Trinh and Quoc V. Le. A simple method for commonsense reasoning. arXiv preprint
arXiv:1806.02847,2018.
[TLBS03] PeterD.Turney,MichaelL.Littman,JeffreyBigham,andVictorShnayder. Combiningindependent
modulestosolvemultiple-choicesynonymandanalogyproblems. CoRR,cs.CL/0309035,2003.
[Tur20] ProjectTuring. Microsoftresearchblog,Feb2020.
[VBL+16] OriolVinyals,CharlesBlundell,TimothyLillicrap,DaanWierstra,etal. MatchingNetworksforOne
ShotLearning. InAdvancesinneuralinformationprocessingsystems,pages3630–3638,2016.
[VSP+17] AshishVaswani,NoamShazeer,NikiParmar,JakobUszkoreit,LlionJones,AidanN.Gomez,Łukasz
Kaiser,andIlliaPolosukhin. Attentionisallyouneed. InAdvancesinneuralinformationprocessing
systems,2017.
[WPN+19] AlexWang,YadaPruksachatkun,NikitaNangia,AmanpreetSingh,JulianMichael,FelixHill,Omer
Levy,andSamuelBowman. Superglue: Astickierbenchmarkforgeneral-purposelanguageunderstand-
ingsystems. InAdvancesinNeuralInformationProcessingSystems,pages3261–3275,2019.
[WXH+18] YirenWang,YingceXia,TianyuHe,FeiTian,TaoQin,ChengXiangZhai,andTie-YanLiu. Multi-agent
duallearning. ICLR2019,2018.
[XDH+19] Qizhe Xie, Zihang Dai, Eduard Hovy, Minh-Thang Luong, and Quoc V. Le. Unsupervised data
augmentationforconsistencytraining,2019.
[YdC+19] DaniYogatama,CypriendeMassond’Autume,JeromeConnor,TomasKocisky,MikeChrzanowski,
LingpengKong,AngelikiLazaridou,WangLing,LeiYu,ChrisDyer,etal. Learningandevaluating
generallinguisticintelligence. arXivpreprintarXiv:1901.11373,2019.
[YDY+19] ZhilinYang,ZihangDai,YimingYang,JaimeCarbonell,RuslanSalakhutdinov,andQuocV.Le. XLNet:
Generalizedautoregressivepretrainingforlanguageunderstanding. arXivpreprintarXiv:1906.08237,
2019.
[ZHB+19] RowanZellers,AriHoltzman,YonatanBisk,AliFarhadi,andYejinChoi. Hellaswag: Canamachine
reallyfinishyoursentence? arXivpreprintarXiv:1905.07830,2019.
[ZHR+19] RowanZellers,AriHoltzman,HannahRashkin,YonatanBisk,AliFarhadi,FranziskaRoesner,andYejin
Choi. Defendingagainstneuralfakenews. arXivpreprintarXiv:1905.12616,2019.
[ZLL+18] Sheng Zhang, Xiaodong Liu, Jingjing Liu, Jianfeng Gao, Kevin Duh, and Benjamin Van Durme.
ReCoRD:Bridgingthegapbetweenhumanandmachinecommonsensereadingcomprehension. arXiv
preprintarXiv:1810.12885,2018.
[ZSW+19a] Daniel M. Ziegler, Nisan Stiennon, Jeffrey Wu, Tom B. Brown, Alec Radford, Dario Amodei, Paul
Christiano,andGeoffreyIrving. Fine-tuninglanguagemodelsfromhumanpreferences,2019.
74

[ZSW+19b] DanielM.Ziegler,NisanStiennon,JeffreyWu,TomB.Brown,AlecRadford,DarioAmodei,PaulChris-
tiano,andGeoffreyIrving.Fine-tuninglanguagemodelsfromhumanpreferences.ArXiv,abs/1909.08593,
2019.
75