RESEARCHARTICLE
On Pixel-Wise Explanations for Non-Linear
Classifier Decisions by Layer-Wise Relevance
Propagation
SebastianBach1,2☯*,AlexanderBinder2,5☯,GrégoireMontavon2,FrederickKlauschen3,
Klaus-RobertMüller2,4*,WojciechSamek1,2*
1MachineLearningGroup,FraunhoferHeinrichHertzInstitute,Berlin,Germany,2MachineLearningGroup,
TechnischeUniversitätBerlin,Berlin,Germany,3CharitéUniversityHospital,Berlin,Germany,
4DepartmentofBrainandCognitiveEngineering,KoreaUniversity,Seoul,Korea,5ISTDPillar,Singapore
a11111
UniversityofTechnologyandDesign(SUTD),Singapore
☯Theseauthorscontributedequallytothiswork.
* sebastian.bach@hhi.fraunhofer.de(SB), klaus-robert.mueller@tu-berlin.de(KM), wojciech.samek@hhi.
fraunhofer.de(WS)
Abstract
OPENACCESS
Citation:BachS,BinderA,MontavonG,Klauschen
Understandingandinterpretingclassificationdecisionsofautomatedimageclassification
F,MüllerK-R,SamekW(2015)OnPixel-Wise
systemsisofhighvalueinmanyapplications,asitallowstoverifythereasoningofthesys-
ExplanationsforNon-LinearClassifierDecisionsby
Layer-WiseRelevancePropagation.PLoSONE10 temandprovidesadditionalinformationtothehumanexpert.Althoughmachinelearning
(7):e0130140.doi:10.1371/journal.pone.0130140 methodsaresolvingverysuccessfullyaplethoraoftasks,theyhaveinmostcasesthedis-
Editor:OscarDenizSuarez,UniversidaddeCastilla- advantageofactingasablackbox,notprovidinganyinformationaboutwhatmadethem
LaMancha,SPAIN arriveataparticulardecision.Thisworkproposesageneralsolutiontotheproblemof
Received:May19,2014 understandingclassificationdecisionsbypixel-wisedecompositionofnonlinearclassifiers.
Weintroduceamethodologythatallowstovisualizethecontributionsofsinglepixelstopre-
Accepted:May15,2015
dictionsforkernel-basedclassifiersoverBagofWordsfeaturesandformultilayeredneural
Published:July10,2015
networks.Thesepixelcontributionscanbevisualizedasheatmapsandareprovidedtoa
Copyright:©2015Bachetal.Thisisanopen
humanexpertwhocanintuitivelynotonlyverifythevalidityoftheclassificationdecision,but
accessarticledistributedunderthetermsofthe
alsofocusfurtheranalysisonregionsofpotentialinterest.Weevaluateourmethodforclas-
CreativeCommonsAttributionLicense,whichpermits
unrestricteduse,distribution,andreproductioninany sifierstrainedonPASCALVOC2009images,syntheticimagedatacontaininggeometric
medium,providedtheoriginalauthorandsourceare shapes,theMNISThandwrittendigitsdatasetandforthepre-trainedImageNetmodel
credited.
availableaspartoftheCaffeopensourcepackage.
DataAvailabilityStatement:Allrelevantdataare
availablefromtheHarvardDataverse:http://dx.doi.
org/10.7910/DVN/D3GIPK—PASCALVOC2009
trainingandvalidationdataset;http://dx.doi.org/10.
7910/DVN/OA9NRS—PASCALVOC2009test;http://
dx.doi.org/10.7910/DVN/W3FOUO—thevarious Introduction
CC0-imagesusedinfigures;http://dx.doi.org/10.
Classificationofimageshasbecomeakeyingredientinmanycomputervisionapplications,
7910/DVN/LXIPZF—thepolygondatasetsfortraining
e.g.imagesearch[1],robotics[2],medicalimaging[3],objectdetectioninradarimages[4]or
andLRP,includinglabels.Thesamedatacanstillbe
foundathttp://doc.ml.tu-berlin.de/layerwise_ facedetection[5].Twoparticularlypopularapproaches,neuralnetworks[6]andBagofWords
relevance_propagation/,aspreviouslystated. (BoW)models[7],arewidelyusedforthesetasksandwereamongthetopsubmissionsincom-
petitionsonimageclassificationandrankingsuchasImageNet[8],PascalVOC[9]andImage-
Funding:SBwasfundedbythePROSECproject
(http://www.prosec-project.org/index.html,grantno. CLEF[10].However,likemanymethodsinmachinelearning,thesemodelsoftenlacka
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 1/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
16BY1145).Thefundershadnoroleinstudydesign, straightforwardinterpretabilityoftheclassifierpredictions.Inotherwordstheclassifieractsas
datacollectionandanalysis,decisiontopublish,or ablackboxanddoesnotprovidedetailedinformationaboutwhyitreachesacertainclassifica-
preparationofthemanuscript.ABandKRMwere
tiondecision.
partiallyfundedbyhttp://www.bmwi.de/EN/root.html
Thislackofinterpretabilityisduetothenon-linearityofthevariousmappingsthatprocess
(grantno.01MQ07018).Thefundershadnorolein
studydesign,datacollectionandanalysis,decisionto therawimagepixelstoitsfeaturerepresentationandfromthattothefinalclassifierfunction.
publish,orpreparationofthemanuscript.KRMwas Thisisaconsiderabledrawbackinclassificationapplications,asithindersthehumanexperts
partiallyfundedbytheBK21programoftheNational tocarefullyverifytheclassificationdecision.Asimpleyesornoanswerissometimesoflimited
ResearchFoundationofKoreaintheBrainKorea21
valueinapplications,wherequestionslikewheresomethingoccursorhowitisstructuredare
program(http://www.nrf.re.kr/nrfengcms/,-nogrant
morerelevantthanabinaryorreal-valuedone-dimensionalassessmentofmerepresenceor
numberavailable),andpartiallyfundedbythe
absenceofacertainstructure.
GermanMinistryforEducationandResearchas
BerlinBigDataCenterBBDC,fundingmark Inthiswork,weaimtoclosethegapbetweenclassificationandinterpretabilitybothfor
01IS14013A.Thefundershadnoroleinstudy multilayeredneuralnetworksandBagofWords(BoW)modelsovernon-linearkernelswhich
design,datacollectionandanalysis,decisionto aretwoclassesofpredictorswhichenjoypopularityincomputervision.Wewillconsiderboth
publish,orpreparationofthemanuscript.GMis
typesofpredictorsinagenericsensetryingtoavoidwheneverpossibleapriorirestrictionsto
fundedasanemployeeoftheMachineLearning
specificalgorithmsormappings.Forthefirstpart,theBagofWordsmodelswillbetreatedas
GroupoftheTUBerlin,http://www.ml.tu-berlin.de/
(research/teaching),http://www.tu-berlin.de/(nogrant anaggregationofnon-linearmappingsoverlocalfeaturesinanimagewhichincludesanum-
numberavailable).Thefundershadnoroleinstudy
berofpopularmappingmethodssuchasFishervectors[11],regularizedcoding[12–14]and
design,datacollectionandanalysis,decisionto softcoding[15],combinedwithdifferentiablenon-linearkernelsandarangeofpoolingfunc-
publish,orpreparationofthemanuscript.FKis
tionsincludingsum-andmax-pooling.Forthesecondpart,theneuralnetworks(e.g.[6,16]),
fundedbytheHumanFrontierScienceProgram
wewillconsidergeneralmultilayerednetworkstructureswitharbitrarycontinuousneurons
(http://www.hfsp.org/,grantno.RGY0077/2011).The
andpoolingfunctionsbasedongeneralizedp-means.
fundershadnoroleinstudydesign,datacollection
andanalysis,decisiontopublish,orpreparationof ThenextSectionPixel-wiseDecompositionasaGeneralConceptwillexplainthebasic
themanuscript.WSwasfundedbytheFederal approachesunderlyingthepixel-wisedecompositionofclassifiers.InSectionBagofWords
MinistryofEducationandResearch(BMBF,http:// modelsrevisited,wewillgiveashortrecapitulationaboutBagofWordsfeaturesandkernel-
www.bmbf.de/)undertheprojectAdaptiveBCI,grant
basedclassifiersandsummarizerelatedwork.Overviewofthedecompositionstepswilldiscuss
no.01GQ1115.Thefundershadnoroleinstudy
thedecompositionofakernel-basedclassifierintosumsofscoresoversmallregionsofthe
design,datacollectionandanalysis,decisionto
publish,orpreparationofthemanuscript. image,andtheprojectiondowntosinglepixels.Ourmethodthenisappliedtoanumberof
popularmappingsandkernelsinSectionExamplesforvariousmappingsandkernels.Pixel-
CompetingInterests:Theauthorsofthismanuscript
wiseDecompositionforMultilayerNetworksappliesboththeTaylor-basedandlayer-wiserele-
havereadthejournal’spolicyandhavethefollowing
competinginterests:AB,FK,andKRMhavea vancepropagationapproachesexplainedinPixel-wiseDecompositionasaGeneralConceptto
pendingpatentapplication:http://www.google.com/ neuralnetworkarchitectures.Theexperimentalevaluationofourframeworkwillbedonein
patents/WO2013037983A1?cl=enandhttp://www. ExperimentsandweconcludethepaperwithadiscussioninDiscussion.
google.com/patents/EP2570970A1?cl=en.This
patentdealswithpixel-wisevisualizationofbagof
wordsfeatures.Thispatentdoesnotdealwith Pixel-wiseDecompositionasaGeneralConcept
artificialneuralnetworks.Theauthorssubmitteda
secondpatentapplication,“RELEVANCESCORE Theoverallideaofpixel-wisedecompositionistounderstandthecontributionofasinglepixel
ASSIGNMENTFORARTIFICIALNEURAL ofanimagextothepredictionf(x)madebyaclassifierfinanimageclassificationtask.We
NETWORKS”withtheprovisionalapplicationnumber
wouldliketofindout,separatelyforeachimagex,whichpixelscontributetowhatextenttoa
PCT/EP2015/056008.Theherebyconfirmthatthis
positiveornegativeclassificationresult.Furthermorewewanttoexpressthisextentquantita-
doesnotaltertheiradherencetoPLOSONEpolicies
tivelybyameasure.Weassumethattheclassifierhasreal-valuedoutputswhicharethre-
onsharingdataandmaterials.Allotherauthors(SB,
GM,WS)havedeclaredthatnocompetinginterests
sholdedatzero.Insuchasetupitisamappingf:RV!R1suchthatf(x)>0denotespresence
existontheirbehalf. ofthelearnedstructure.Probabilisticoutputscanbetreatedwithoutlossofgeneralitybysub-
tracting0.5.Weareinterestedtofindoutthecontributionofeachinputpixelx ofaninput
(d)
imagextoaparticularpredictionf(x).Theimportantconstraintspecifictoclassificationcon-
sistsinfindingthedifferentialcontributionrelativetothestateofmaximaluncertaintywith
respecttoclassificationwhichisthenrepresentedbythesetofrootpointsf(x )=0.Onepossi-
0
blewayistodecomposethepredictionf(x)asasumoftermsoftheseparateinputdimensions
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 2/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
Fig1.Visualizationofthepixel-wisedecompositionprocess.Intheclassificationsteptheimageisconvertedtoafeaturevectorrepresentationanda
classifierisappliedtoassigntheimagetoagivencategory,e.g.,“cat”or“nocat”.Notethatthecomputationofthefeaturevectorusuallyinvolvestheusage
ofseveralintermediaterepresentations.Ourmethoddecomposestheclassificationoutputf(x)intosumsoffeatureandpixelrelevancescores.Thefinal
relevancesvisualizethecontributionsofsinglepixelstotheprediction.Catimagebypixabayuserstinne24.
doi:10.1371/journal.pone.0130140.g001
x respectivelypixels:
d
X
V
fðxÞ(cid:2) R ð1Þ
d
d¼1
ThequalitativeinterpretationisthatR <0contributesevidenceagainstthepresenceofa
d
structurewhichistobeclassifiedwhileR >0contributesevidenceforitspresence.Interms
d
ofsubsequentvisualization,whichhoweverwillnotbethescopeofthispaper,theresultingrel-
evancesR foreachinputpixelx canbemappedtoacolorspaceandvisualizedinthatway
d (d)
asaconventionalheatmap.Onebasicconstraintwillbeinthefollowingworkthatthesignsof
R shouldfollowabovequalitativeinterpretation,i.e.positivevaluesshoulddenotepositive
d
contributions,negativevaluesnegativecontributions.Fig1depictsthemainideaofour
method.
Inthispaperweproposeanovelconceptwedenoteaslayer-wiserelevancepropagationasa
generalconceptforthepurposeofachievingapixel-wisedecompositionasinEq(1).Wealso
discussanapproachbasedonTaylordecompositionwhichyieldsanapproximationoflayer-
wiserelevancepropagation.Wewillshowthatforawiderangeofnon-linearclassification
architectures,layer-wiserelevancepropagationcanbedonewithouttheneedtouseanapprox-
imationbymeansofTaylorexpansion.Themethodsweproposeinthispaperdonotinvolve
segmentation.Theydonotrequirepixel-wisetrainingaslearningsetuporpixel-wiselabeling
forthetrainingphase.Thesetupusedhereisimage-wiseclassification,inwhichduringtrain-
ingonelabelisprovidedforanimageasawhole,however,thecontributionofthispaperisnot
aboutclassifiertraining.Theproposedmethodsarebuiltontopofapre-trainedclassifier.
Theyareevenapplicabletoanalreadypre-trainedimageclassifierasshowninSectionNeural
Networkfor1000ILSVRCclasses.
Layer-wiserelevancepropagation
Wewillintroducelayer-wiserelevancepropagationasaconceptdefinedbyasetofconstraints.
Anysolutionsatisfyingtheconstraintswillbeconsideredtofollowtheconceptoflayer-wise
relevancepropagation.Inlatersectionswewillthenderivesolutionsfortwoparticularclassi-
fierarchitecturesandevaluatethesesolutionsexperimentallyfortheirmeaningfulness.Layer-
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 3/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
wiserelevancepropagationinitsgeneralformassumesthattheclassifiercanbedecomposed
intoseverallayersofcomputation.Suchlayerscanbepartsofthefeatureextractionfromthe
imageorpartsofaclassificationalgorithmrunonthecomputedfeatures.Asshownlater,this
ispossibleforBagofWordsfeatureswithnon-linearSVMsaswellasforneuralnetworks.
Thefirstlayeraretheinputs,thepixelsoftheimage,thelastlayeristhereal-valuedpredic-
¼ðzðlÞÞVðlÞwithdimension-
tionoutputoftheclassifierf.Thel-thlayerismodeledasavectorz
d d¼1
alityV(l).Layer-wiserelevancepropagationassumesthatwehaveaRelevancescoreRðlþ1Þfor
d
eachdimensionzðlþ1Þofthevectorzatlayerl+1.TheideaistofindaRelevancescoreRðlÞfor
|     | d   |     |     |     |     |     | d   |
| --- | --- | --- | --- | --- | --- | --- | --- |
eachdimensionzðlÞofthevectorzatthenextlayerlwhichisclosertotheinputlayersuchthat
d
thefollowingequationholds.
|     |     |                             | X      | X    | X                       |      |     |
| --- | --- | --------------------------- | ------ | ---- | ----------------------- | ---- | --- |
|     |     |                             | Rðlþ1Þ | RðlÞ |                         | Rð1Þ |     |
|     |     | fðxÞ¼(cid:3)(cid:3)(cid:3)¼ |        | ¼    | ¼(cid:3)(cid:3)(cid:3)¼ |      |     |
|     |     |                             | d      | d    |                         | d    | ð2Þ |
|     |     |                             | d2lþ1  | d2l  |                         | d    |     |
IteratingEq(2)fromthelastlayerwhichistheclassifieroutputf(x)downtotheinputlayer
xconsistingofimagepixelsthenyieldsthedesiredEq(1).TheRelevancefortheinputlayer
willserveasthedesiredsumdecompositioninEq(1).Inthefollowingwewillderivefurther
constraintsbeyondEqs(1)and(2)andmotivatethembyexamples.Aswewillshownow,a
decompositionsatisfyingEq(2)perseisneitherunique,noritisguaranteedthatityieldsa
meaningfulinterpretationoftheclassifierprediction.
Wegivehereasimplecounterexample.Supposewehaveonelayer.Theinputsarex2RV.
Weusealinearclassifierwithsomearbitraryanddimension-specificfeaturespacemappingϕ
d
andabiasb
X
(cid:2)
|     |     |     | fðxÞ¼bþ | a   | ðx Þ |     | ð3Þ |
| --- | --- | --- | ------- | --- | ---- | --- | --- |
d d d
d
LetusdefinetherelevanceforthesecondlayertriviallyasRð2Þ ¼fðxÞ.Then,onepossible
1
layer-wiserelevancepropagationformulawouldbetodefinetherelevanceR(1)fortheinputsx
as
8
|     |      |          | ja (cid:2)    | P    |             |     |     |
| --- | ---- | -------- | ------------- | ---- | ----------- | --- | --- |
|     |      | >>><fðxÞ | P ðx          | Þj   | (cid:2)     |     |     |
|     |      |          | d d d         | if   | ja ðx Þj6¼0 |     |     |
|     |      |          | j a (cid:2) ð | x Þj | d d d d     |     |     |
|     |      |          | d d d         | d    |             |     |     |
|     | Rð1Þ | ¼        |               |      |             |     | ð4Þ |
d >>>:
|     |     | b   |     | P   |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | --- |
(cid:2)
|     |     |     |     | if  | ja ðx Þj¼0 |     |     |
| --- | --- | --- | --- | --- | ---------- | --- | --- |
|     |     | V   |     |     | d d d d    |     |     |
ThisclearlysatisfiesEqs(1)and(2),howevertheRelevancesR(1)(x )ofallinputdimensions
d
havethesamesignasthepredictionf(x).Intermsofpixel-wisedecompositioninterpretation,
allinputspointtowardsthepresenceofastructureiff(x)>0andtowardstheabsenceofa
structureiff(x)<0.Thisisformanyclassificationproblemsnotarealisticinterpretation.
Letusdiscussamoremeaningfulwayofdefininglayer-wiserelevancepropagation.Forthis
examplewedefine
b
|     |     |     | Rð1Þ ¼ | þa (cid:2) ðx | Þ   |     | ð5Þ |
| --- | --- | --- | ------ | ------------- | --- | --- | --- |
|     |     |     | d      | V d d         | d   |     |     |
Then,therelevanceofafeaturedimensionx dependsonthesignoftheterminEq(5).Thisis
d
formanyclassificationproblemsamoreplausibleinterpretation.Thissecondexampleshows
thatthelayer-wiserelevancepropagationisabletodealwithnon-linearitiessuchasthefeature
spacemappingϕ
tosomeextentandhowanexampleoflayer-wiserelevancepropagationsat-
d
isfyingFormula(2)maylooklikeinpractice.Notethatnoregularityassumptiononthefeature
| PLOSONE|DOI:10.1371/journal.pone.0130140 | July10,2015 |     |     |     |     |     | 4/46 |
| ---------------------------------------- | ----------- | --- | --- | --- | --- | --- | ---- |

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
Fig2.Left:Aneuralnetwork-shapedclassifierduringpredictiontime.w areconnectionweights.a is
ij i
theactivationofneuroni.Right:Theneuralnetwork-shapedclassifierduringlayer-wiserelevance
computationtime.RðlÞistherelevanceofneuroniwhichistobecomputed.Inordertofacilitatethe
i
computationofRðlÞweintroducemessagesRðl;lþ1Þ.Rðl;lþ1Þaremessageswhichneedtobecomputedsuchthat
i i j i j
thelayer-wiserelevanceinEq(2)isconserved.Themessagesaresentfromaneuronitoitsinputneuronsj
viatheconnectionsusedforclassification,e.g.2isaninputneuronforneurons4,5,6.Neuron3isaninput
neuronfor5,6.Neurons4,5,6aretheinputforneuron7.
doi:10.1371/journal.pone.0130140.g002
spacemappingϕ isrequiredhereatall,itcouldbeevennon-continuous,ornon-measurable
d
undertheLebesguemeasure.TheunderlyingFormula(2)canbeinterpretedasaconservation
lawfortherelevanceRinbetweenlayersofthefeatureprocessing.
TheaboveexamplegivesfurthermoreanintuitionaboutwhatrelevanceRis,namely,the
localcontributiontothepredictionfunctionf(x).Inthatsensetherelevanceoftheoutputlayer
isthepredictionitselff(x).Thisfirstexampleshowswhatonecouldexpectasadecomposition
forthelinearcase.Thelinearcaseisnotanovelty,however,itprovidesafirstintuition.
Wegiveasecond,moregraphicandnon-linear,example.TheleftpanelofFig2showsa
neuralnetwork-shapedclassifierwithneuronsandweightsw onconnectionsbetweenneu-
ij
rons.Eachneuronihasanoutputa fromanactivationfunction.
i
Thetoplayerconsistsofoneoutputneuron,indexedby7.Foreachneuroniwewouldlike
tocomputearelevanceR.WeinitializethetoplayerrelevanceRð3Þasthefunctionvalue,thus
i 7
Rð3Þ ¼fðxÞ.Layer-wiserelevancepropagationinEq(2)requiresnowtohold
7
Rð3Þ ¼Rð2ÞþRð2ÞþRð2Þ ð6Þ
7 4 5 6
Rð2ÞþRð2ÞþRð2Þ ¼Rð1ÞþRð1ÞþRð1Þ ð7Þ
4 5 6 1 2 3
Wewillmaketwoassumptionsforthisexample.Firstly,weexpressthelayer-wiserelevancein
termsofmessagesRðl;lþ1Þbetweenneuronsiandjwhichcanbesentalongeachconnection.
i j
Themessagesare,however,directedfromaneurontowardsitsinputneurons,incontrastto
whathappensatpredictiontime,asshownintherightpanelofFig2.Secondly,wedefinethe
relevanceofanyneuronexceptneuron7asthesumofincomingmessages:
X
RðlÞ ¼ Rðl;lþ1Þ
i i k ð8Þ
k:i is input forneuron k
ForexampleRð1Þ ¼Rð1;2ÞþRð1;2Þ.Notethatneuron7hasnoincomingmessagesanyway.
3 3 5 3 6
InsteaditsrelevanceisdefinedasRð3Þ ¼fðxÞ.InEq(8)andthefollowingtextthetermsinput
7
andsourcehavethemeaningofbeinganinputtoanotherneuroninthedirectionasdefined
duringclassificationtime,notduringthetimeofcomputationoflayer-wiserelevance
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 5/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
propagation.ForexampleinFig2neurons1and2areinputsandsourceforneuron4,while
neuron6isthesinkforneurons2and3.GiventhetwoassumptionsencodedinEq(8),the
layer-wiserelevancepropagationbyEq(2)canbesatisfiedbythefollowingsufficientcondi-
tion:
|     |     |     |     | Rð3Þ ¼Rð2;3ÞþRð2;3ÞþRð2;3Þ |     |         |     |     | ð9Þ |
| --- | --- | --- | --- | -------------------------- | --- | ------- | --- | --- | --- |
|     |     |     |     | 7                          | 4 7 | 5 7 6 7 |     |     |     |
Rð2Þ ¼Rð1;2ÞþRð1;2Þ
ð10Þ
|     |     |     |     | 4   | 1 4 | 2 4 |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
¼Rð1;2ÞþRð1;2ÞþRð1;2Þ
|     |     |     |     | Rð2Þ |                |         |     |     | ð11Þ |
| --- | --- | --- | --- | ---- | -------------- | ------- | --- | --- | ---- |
|     |     |     |     | 5    | 1 5            | 2 5 3 5 |     |     |      |
|     |     |     |     | Rð2Þ | ¼Rð1;2ÞþRð1;2Þ |         |     |     | ð12Þ |
|     |     |     |     | 6    | 2 6            | 3 6     |     |     |      |
Ingeneral,thisconditioncanbeexpressedas:
X
|     |     |     |     | Rðlþ1Þ ¼ |     | Rðl;lþ1Þ |     |     |     |
| --- | --- | --- | --- | -------- | --- | -------- | --- | --- | --- |
ð13Þ
|     |     |     |     | k   |                       | i k |     |     |     |
| --- | --- | --- | --- | --- | --------------------- | --- | --- | --- | --- |
|     |     |     |     |     | i:iis input forneuron | k   |     |     |     |
Thedifferencebetweencondition(13)anddefinition(8)isthatinthecondition(13)thesum
runsoverthesourcesatlayerlforafixedneuronkatlayerl+1,whileinthedefinition(8)the
sumrunsoverthesinksatlayerl+1forafixedneuroniatalayerl.WhenusingEq(8)todefine
therelevanceofaneuronfromitsmessages,thencondition(13)isasufficientconditionin
ordertoensurethatEq(2)holds.SummingoverthelefthandsideinEq(13)yields
|     |     |     | X   |        | X   | X   |          |     |     |
| --- | --- | --- | --- | ------ | --- | --- | -------- | --- | --- |
|     |     |     |     | Rðlþ1Þ |     |     | Rðl;lþ1Þ |     |     |
¼
|     |     |     |     | k   |     |     | i k |     |     |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
i:i
|     |     |     | k   |     | Xk  | is inpuXt forneuron | k   |     |     |
| --- | --- | --- | --- | --- | --- | ------------------- | --- | --- | --- |
Rðl;lþ1Þ
¼
i k
|     |     |     |     |     | i k:i | is input forneuron | k   |     |     |
| --- | --- | --- | --- | --- | ----- | ------------------ | --- | --- | --- |
X
|     |     |     |     | eq  | :ð8Þ RðlÞ |     |     |     |     |
| --- | --- | --- | --- | --- | --------- | --- | --- | --- | --- |
¼
i
i
Onecaninterpretcondition(13)bysayingthatthemessagesRðl;lþ1Þareusedtodistributethe
i k
relevanceRðlþ1Þofaneuronkontoitsinputneuronsatlayerl.Ourworkinthefollowingsec-
k
tionswillbebasedonthisnotionandthemorestrictformofrelevanceconservationasgiven
bydefinition(8)andcondition(13).WesetEqs(8)and(13)asthemainconstraintsdefining
layer-wiserelevancepropagation.Asolutionfollowingthisconceptisrequiredtodefinethe
messagesRðl;lþ1Þaccordingtotheseequations.
i k
Nowwecanderiveanexplicitformulaforlayer-wiserelevancepropagationforourexample
bydefiningthemessagesRðl;lþ1Þ.Thelayer-wiserelevancepropagationshouldreflectthemes-
i k
sagespassedduringclassificationtime.Weknowthatduringclassificationtime,aneuroni
inputsaw toneuronk,providedthatihasaforwardconnectiontok.Thus,wecanrewrite
i ik
thelefthandsidesofEqs(9)and(10)sothatitmatchesthestructureoftherighthandsidesof
thesameequationsbythefollowing
|                                          |             |           |       | a w          |           | a w          |           | a w          |      |
| ---------------------------------------- | ----------- | --------- | ----- | ------------ | --------- | ------------ | --------- | ------------ | ---- |
|                                          |             | Rð 3Þ ¼Rð | 3ÞP   |              | 3ÞP       |              | 3ÞP       |              |      |
|                                          |             |           |       | 4 4 7        | þRð       | 5 5 7        | þRð       | 6 6 7        | ð14Þ |
|                                          |             | 7         | 7     | a w          | 7         | a w          | 7         | a w          |      |
|                                          |             |           |       | i¼4;5;6 i i7 |           | i¼4;5;6 i i7 |           | i¼4;5;6 i i7 |      |
|                                          |             |           |       |              | a w       |              | a w       |              |      |
|                                          |             |           | Rð 2Þ | ¼Rð 2ÞP      | 1 14      | þRð 2ÞP      | 2 24      |              |      |
|                                          |             |           | 4     | 4            |           | 4            |           |              | ð15Þ |
|                                          |             |           |       |              | i¼1;2 a w |              | i¼1;2 a w |              |      |
|                                          |             |           |       |              | i i4      |              | i i4      |              |      |
| PLOSONE|DOI:10.1371/journal.pone.0130140 | July10,2015 |           |       |              |           |              |           |              | 6/46 |

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
ThematchoftherighthandsidesofEqs(9)and(10)againsttherighthandsidesof(14)and
(15)canbeexpressedingeneralas
aw
Rðl;lþ1Þ ¼Rðlþ1ÞPi ik ð16Þ
i k k a w
h h hk
Whilethissolution(16)formessagetermsRðl;lþ1Þstillneedstobeadaptedsuchthatitis
i k
usablewhenthedenominatorbecomeszero,theexamplegiveninEq(16)givesanideawhata
messageRðl;lþ1Þcouldbe,namelytherelevanceofasinkneuronRðlþ1Þwhichhasbeenalready
i k k
computed,weightedproportionallybytheinputoftheneuronifromtheprecedinglayerl.
Thisnotionholdsinananalogouswaywhenweusedifferentclassificationarchitecturesand
replacethenotionofaneuronbyadimensionofafeaturevectoratagivenlayer.
TheFormula(16)hasasecondproperty:ThesignoftherelevancesentbymessageRðl;lþ1Þ
i k
becomesinvertedifthecontributionofaneurona w hasdifferentsignthenthesumofthe
i ik
contributionsfromallinputneurons,i.e.iftheneuronfiresagainsttheoveralltrendforthetop
neuronfromwhichitinheritsaportionoftherelevance.Sameasfortheexamplewiththelin-
earmappinginEq(5),aninputneuroncaninheritpositiveornegativerelevancedepending
onitsinputsign.ThisisadifferencetotheEq(4).Whilethissignswitchingpropertycanbe
definedanalogouslyforarangeofarchitectures,wedonotadditasaconstraintforlayer-wise
relevancepropagation.
Onefurtherpropertyisvisiblehereaswell.Theformulafordistributionofrelevanceis
applicabletonon-linearandevennon-differentiableornon-continuousneuronactivationsa .
k
AnalgorithmwouldstartwithrelevancesR(l+1)oflayerl+1whichhavebeencomputedalready.
ThenthemessagesRðl;lþ1Þwouldbecomputedforallelementskfromlayerl+1andelementsi
i k
fromtheprecedinglayerl—inamannersuchthatEq(13)holds.Thendefinition(8)wouldbe
usedtodefinetherelevancesR(l)forallelementsoflayerl.
Therelevanceconservationpropertycaninprinciplebesupplementedbyotherconstraints
thatfurtherreducethesetofadmissiblesolutions.Forexample,onecouldconstrainrelevance
messagesRðl;lþ1Þthatresultfromtheredistributionofrelevanceontolower-levelnodesinaway
i k
thatisconsistentwiththecontributionoflower-levelnodestotheupperlayerduringthefor-
wardpass.Ifanodeihasalargerweightedactivationz =aw ,then,inaqualitativesense,it
ik i ik
shouldalsoreceivealargerfractionoftherelevancescoreRðlþ1Þofthenodek.Inparticular,for
k
allnodesksatisfyingR ,∑ z >0,onecandefinetheconstraint
k i ik
0<z <z )Rðl;lþ1Þ (cid:4)Rðl;lþ1Þ.(TheformulasprovidedinsectionPixel-wiseDecomposition
ik i0k i k i0 k
forMultilayerNetworksadheretothisorderingconstraint.)Nevertheless,nothingissaidabout
theexactrelevancevaluesbeyondtheiradherencetotheconstraintstatedabove.
Tosummarize,wehaveintroducedlayer-wiserelevancepropagationinafeed-forwardnet-
work.Inourproposeddefinition,thetotalrelevanceisconstrainedtobepreservedfromone
layertoanother,andthetotalnoderelevancemustbetheequaltothesumofallrelevancemes-
sagesincomingtothisnodeandalsoequaltothesumofallrelevancemessagesthatareoutgo-
ingtothesamenode.Itisimportanttonotethatthedefinitionisnotgivenasanalgorithmor
asolutionofanobjectivewithadistinctminimum.Instead,itisgivenasasetofconstraints
thatthesolutionshouldsatisfy.Thus,differentalgorithmswithdifferentresultingsolutions
maybeadmissibleundertheseconstraints.
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 7/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
Taylor-typedecomposition
Onealternativeapproachforachievingadecompositionasin(1)forageneraldifferentiable
predictorfisfirstorderTaylorapproximation.
fðxÞ (cid:2) fðx ÞþDfðx Þ½x(cid:5)x (cid:6)
0 0 0
X V @f ð17Þ
¼ fðx Þþ ðx Þðx (cid:5)x Þ
0 @x 0 ðdÞ 0ðdÞ
d¼1 ðdÞ
ThechoiceofaTaylorbasepointx isafreeparameterinthissetup.Assaidabove,incaseof
0
classificationweareinterestedtofindoutthecontributionofeachpixelrelativetothestateof
maximaluncertaintyofthepredictionwhichisgivenbythesetofpointsf(x )=0,sincef(x)>
0
0denotespresenceandf(x)<0absenceofthelearnedstructure.Thus,x shouldbechosento
0
bearootofthepredictorf.ForthesakeofprecisionoftheTaylorapproximationofthepredic-
tion,x shouldbechosentobeclosetoxundertheEuclideannorminordertominimizethe
0
TaylorresiduumaccordingtohigherorderTaylorapproximations.Incaseofmultipleexisting
rootsx withminimalnorm,theycanbeaveragedorintegratedinordertogetanaverageover
0
allthesesolutions.Theaboveequationsimplifiesto
X V @f
fðxÞ(cid:2) ðx Þðx (cid:5)x Þ such that fðx Þ¼0 ð18Þ
@x 0 ðdÞ 0ðdÞ 0
d¼1 ðdÞ
Thepixel-wisedecompositioncontainsanon-lineardependenceonthepredictionpointx
beyondtheTaylorseries,asacloserootpointx needstobefound.Thusthewholepixel-wise
0
decompositionisnotalinear,butalocallylinearalgorithm,astherootpointx dependsonthe
0
predictionpointx.
Severalworkshavebeenusingsensitivitymaps[17–19]forvisualizationofclassifierpredic-
tionswhichwerebasedonusingpartialderivativesatthepredictionpointx.Therearetwo
essentialdifferencesbetweensensitivitymapsbasedonderivativesatthepredictionpointx
andthepixel-wisedecompositionapproach.Firstly,thereisnodirectrelationshipbetweenthe
functionvaluef(x)atthepredictionpointxandthedifferentialDf(x)atthesamepointx.Sec-
ondly,weareinterestedinexplainingtheclassifierpredictionrelativetoacertainstategivenby
thesetofrootsofthepredictionfunctionf(x )=0.ThedifferentialDf(x)attheprediction
0
pointdoesnotnecessarilypointtoarootwhichiscloseundertheEuclideannorm.Itpointsto
thenearestlocaloptimumwhichmaystillhavethesamesignasthepredictionf(x)andthusbe
misleadingforexplainingthedifferencetothesetofrootpointsofthepredictionfunction.
Thereforederivativesatthepredictionpointxarenotusefulforachievingouraim.Fig3illus-
tratesthequalitativedifferencebetweenlocalgradients(blackarrows)andthedimension-wise
decompositionoftheprediction(redarrow).
Onetechnicaldifficultyistofindarootpointx .Forcontinuousclassifierswemayuse
0
unlabeledtestdatainasamplingapproachandperformalinesearchbetweentheprediction
pointxandasetofcandidatepoints{x0}suchthattheirpredictionhasoppositesign:f(x)f(x0)
<0.Itisclearthatthelinel(a)=ax+(1−a)x0mustcontainarootoffwhichcanbefoundby
intervalintersection.Thuseachcandidatepointx0yieldsoneroot,andonemayselectaroot
pointwhichminimizestheTaylorresiduumoruseanaverageoverasubsetofrootpointswith
lowTaylorresidues.Asecondpossiblesolutionwouldbe,forexample,tofindtherootpointx
0
thatisthenearesttothedatapointx,oroptimalinsomemeasurablesense.However,whilewe
havepresentedtwotypesofsolutionstofindingarootpoint,inthemostgeneralcase,theTay-
lor-typedecompositionisbestdescribedasaconstraint-basedapproach.Inparticular,theroot
pointx atwhichtheTaylordecompositioniscomputedisconstrainedtosatisfyf(x )=0and
0 0
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 8/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
Fig3.Anexemplaryreal-valuedpredictionfunctionforclassificationwiththedashedblacklinebeingthedecisionboundarywhichseparatesthe
bluefromthegreendots.Thebluedotsarelabelednegatively,thegreendotsarelabeledpositively.Left:Localgradientoftheclassificationfunctionatthe
predictionpoint.Right:Taylorapproximationrelativetoarootpointonthedecisionboundary.Thisfiguredepictstheintuitionthatagradientataprediction
pointx—hereindicatedbyasquare—doesnotnecessarilypointtoaclosepointonthedecisionboundary.Insteaditmaypointtoalocaloptimumortoafar
awaypointonthedecisionboundary.Inthisexampletheexplanationvectorfromthelocalgradientatthepredictionpointxhasatoolargecontributioninan
irrelevantdirection.Theclosestneighborsoftheotherclasscanbefoundataverydifferentangle.Thus,thelocalgradientatthepredictionpointxmaynot
beagoodexplanationforthecontributionsofsingledimensionstothefunctionvaluef(x).Localgradientsatthepredictionpointintheleftimageandthe
Taylorrootpointintherightimageareindicatedbyblackarrows.Thenearestrootpointx isshownasatriangleonthedecisionboundary.Theredarrowin
0
therightimagevisualizestheapproximationoff(x)byTaylorexpansionaroundthenearestrootpointx .Theapproximationisgivenasavectorrepresenting
0
thedimension-wiseproductbetweenDf(x )(theblackarrowintherightpanel)andx−x (thedashedredlineintherightpanel)whichisequivalenttothe
0 0
diagonaloftheouterproductbetweenDf(x )andx−x .
0 0
doi:10.1371/journal.pone.0130140.g003
tolienottoofar(e.g.withinafixedradius)fromtheactualdatapointx.Usingthisconstraint-
baseddefinition,themostdesirablepropertiesoftheTaylordecompositionarepreserved,
whiletheremainingspecificationisdeferredtoalaterpointintime.
NotethatTaylor-typedecomposition,whenappliedtoonelayerorasubsetoflayers,canbe
seenasanapproximatewayofrelevancepropagationwhenthefunctionishighlynon-linear.
Thisholdsinparticularwhenitisappliedtotheoutputfunctionfasafunctionofthepreced-
inglayerf=f(z i−1 ),asEq(18)satisfiesapproximatelythepropagationEq(2)whentherele-
vanceoftheoutputlayerisinitializedasthevalueofpredictionfunctionf(x).Unlikethe
Taylorapproximation,layer-wiserelevancepropagationdoesnotrequiretouseasecondpoint
besidestheinputpoint.TheformulasinSectionsPixel-wiseDecompositionforClassifiersover
BagofWordsFeaturesandPixel-wiseDecompositionforMultilayerNetworkswilldemonstrate
thatlayer-wiserelevancepropagationcanbeimplementedforawiderangeofarchitectures
withouttheneedtoapproximatebymeansofTaylorexpansion.
RelatedWork
Severalworkshavebeendedicatedtothetopicofexplainingneuralnetworks,kernel-based
classifiersingeneralandclassifiersoverBagofWordsfeaturesinparticular.
Asforneuralnetworks,[20]isdedicatedtowardsanalyzingclassifierdecisionsatneurons
whichisapplicablealsotothepixellevel.Itperformsalayer-wiseinversiondownfromoutput
layerstowardstheinputpixelsforthearchitectureofconvolutionalnetworks[21].Thiswork
isspecifictothearchitectureofconvolutionalneuralnetworks.Comparedtoourapproachitis
basedonadifferentprinciple.See[22]whichestablishesaninterpretationoftheworkin[20]
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 9/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
asanapproximationtopartialderivativeswithrespecttopixelsintheinputimage.Inahigh-
levelsense,theworkin[20]usesthemethodfromtheirownpredecessorworkin[23]which
solvesoptimizationproblemsinordertoreconstructtheimageinput,whileourapproach
attemptstoreconstructtheclassifierdecision.Inamoretechnicalsense,thedifferencebetween
[20]andourapproachcanbeseenbycomparinghowtheresponsesareprojecteddown
towardstheinputs.[20]usesrectifiedlinearunitstoprojectinformationfromtheunfolded
mapstowardstheinputswiththeaimtoensurethefeaturemapstobenon-negative.Inour
approachweusethesignedactivationsoftheneuronsfromthelayerbelowforweightingthe
relevancequantityfromthelayerabovewiththeaimofconservingtherelevancequantity
acrosslayers.Thesignoftheactivationsofneuronsofthelayerbelow,forwhichtherelevance
istobecomputed,isusedinourworkforencodingassumptionsaboutthestructureofthe
neuralnetwork.Withrespecttoneuralnetworks,ourworkisapplicabletoawiderangeof
architectures.Adifferenttypeofanalysisforunderstandingneuralnetworksdealswithcreat-
ingcounter-intuitiveexamples,seeforexampletheworkin[24,25].Foratreatmentonhowto
discriminatestructureswhichinfluencepredictionsfromcorrelationswithhiddenvariables
suchthatthehiddenvariableshaveanimpactonthepredictor,see[26].
AnotherapproachwhichliesbetweenpartialderivativesattheinputpointxandafullTay-
lorseriesaroundadifferentpointx ispresentedin[22].Thisworkusesadifferentpointx
0 0
thantheinputpointxforcomputingthederivativeandaremainderbiaswhichbotharenot
specifiedfurtherbutavoidsforanunspecifiedreasontousethefulllinearweightingtermx−
x ofaTaylorseries.BesidesdeviatingintheusageofaTaylorseries,theworkin[22]doesnot
0
makeuseofthelayer-wisepropagationstrategyforneuralnetworkspresentedinthispaper,
whichunlikeaTaylorseriesdoesnotrelyonalocalapproximation.Explanationofneuralnet-
workbehavioronthelevelofsingleneuronsisdonein[27]and[28].Theseworkstrytofind
inputswhichmaximizetheactivationofneuronsbymeansofoptimizationproblemswhich
canbesolvedbygradientascent.Ourapproachaimsatexplainingthedecisionforagiven
inputratherthanfindingoptimalstimuliforaparticularneuron.Notethattheapproachpre-
sentedinourpaperisdifferentfromplottingtheactivationsofneuronsduringaforward-pass
oftheinputimage.Thelatterisindependentfromtheneuralnetworkpropertiesinhigherlay-
erswhereasinourapproachwefeedtheclassificationscoreintothetopneuronsandusequan-
titiescomputedbyusingpropertiesofhigherlayerstoobtainarepresentationatlowerlayers.
Quantifyingtheimportanceofinputvariablesusinganeuralnetworkmodelhasalsobeen
studiedinspecificareassuchasecologicalmodeling,where[29,30]surveyedalargeensemble
ofpossibleanalyses,including,computingpartialderivatives,perturbationanalysis,weights
analysis,andstudyingtheeffectofincludingandremovingvariablesattrainingtime.Adiffer-
entavenuetounderstandingdecisionsinneuralnetworkistofitamoreinterpretablemodel
(e.g.decisiontree)tothefunctionlearnedbytheneuralnetwork[31],andextracttherules
learnedbythisnewmodel.
Withrespecttosensitivityofkernel-basedclassifierstoinputdimensions,[32]yieldssensi-
tivitymaps,whichareinvarianttothesignofthepredictions.[17–19]considerexplanation
vectorsbasedonlocalgradientswhicharesign-sensitive.Bothapproachesusepartialderiva-
tivesatthepointwhichistobepredicted.ThefirstworkstoourknowledgetovisualizeBoW
modelsare[33]and[34].Theformerworkfindsregionswithalargeinfluenceforclassification
forthespecialcaseofmaxpooling,sparsecodingandalinearclassifier.Thelatterworkobtains
anexactdecompositionintolocalfeaturescoresforthecaseofahistogramintersectionkernel
andzero-onecodingoflocalfeaturesontovisualwords.
Wedifferfromtheaboveworksonkernel-basedclassifiersoverBagofWordsfeaturesin
thefollowingsense:OurmethodologyisapplicabletoarbitraryBagofWordsmodelsincluding
variousfeaturecodingssuchasFishervectorsandregularizedcodingsandtoabroaderclassof
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 10/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
kernels,namelyalldifferentiableorso-calledsumdecomposablekernels.Whenrelyingon
Taylordecomposition,ourworkreliesonaTaylorseriesaroundarootclosetotheprediction
pointratherthanpartialderivativesatthepredictionpointitself.Therationaleforthischoice
wasjustifiedintheprecedingSectionTaylor-typedecomposition.Finally,incontrasttothepre-
cedingpublications,ourworkintroduceslayer-wiserelevancepropagationforneuralnetworks
andBagofWordsfeatures.
Pixel-wiseDecompositionforClassifiersoverBagofWords
Features
Despiterecentadvancesinneuralnetworks,BagofWordsmodelsarestillpopularforimage
classificationtasks.Theyhaveexcelledinpastcompetitionsonvisualconceptrecognitionand
rankingsuchasPascalVOC[35,36]andImageCLEFPhotoAnnotation[37].Inourexperience
BagofWordsModelsperformwellfortaskswithsmallsamplesizes,whereasneuralnetworks
areatrisktooverfitduetotheirricherparameterstructure.
BagofWordsmodelsrevisited
WewillconsiderhereBagofWordsfeaturesasanaggregationofnon-linearmappingsoflocal
features.AllBagofWordsmodels,nomatterwhetherbasedonhierarchicalclustering[38],
softcodebookmapping[15,39–41],regularizedlocalcodings[12–14],orFisherVectors[11],
shareamulti-stageprocedureincommon.
Inthefirststagelocalfeaturesarecomputedacrosssmallregionsintheimage.Alocalfea-
turesuchasSIFT[42,43]isintheabstractsenseavectorcomputedfromaregionofthe
image,forexamplecapturinginformationofinterestsuchasshapecharacteristicsorproperties
ofcolorortextureonalocalscale.Inasecondstagewhichisperformedonceduringtraining,
representativesinthespaceoflocalfeaturesarecomputed,nomatterwhethertheyarecluster
centroidsobtainedfromk-meansclustering,regionsofthespaceasforclusteringtrees[38],or
centersofdistributionsasforFishervectors[44].Thesetofrepresentatives,inthefollowing
referredtoasvisualwords,servesasavocabularyinthecontextofwhichimagescanbe
describedasvectors.Inthethirdstage,statisticsofthelocalfeaturesarecomputedrelativeto
thosevisualwords.Thesestatisticsareaggregatedfromalllocalfeatureslwithinanimagein
ordertoyieldaBoWrepresentationx,usuallydonebysum-ormax-pooling.
Thecomputationofstatisticscanbemodeledbyamappingfunctionacceptinglocalfeature
vectorslasinput,whicharethenprojectedintotheBagofWordsfeaturespace.Letmbesuch
amappingfunctionandletm denotethemappingontothed-thdimensionoftheBoW
(d)
space.Weassumetheverygenericp-meansmappingschemeforlocalfeatureslasgiveninEq
(19).
!1
X
M p
x ¼ M(cid:5)1 ðm ðlÞÞp ð19Þ
ðdÞ ðdÞ j
j¼1
Thiscontainssum-andmax-poolingasthespecialcasesp=1andthelimitp=1.
Finally,aclassifierisappliedontopofthesefeatures.Ourmethodsupportsthegeneralclass
ofclassifiersbasedonkernelmethods.ForbrevityweusehereanSVMpredictionfunction
whichresultsinapredictionfunctionoverBoWfeaturesx,trainingdatalabelsy,kernel
i i
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 11/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
Table1.NotationConventionsUsedinThisSection.
theclassifier’spredictionfunction
f((cid:3))
|     | x,y          |     | BoWrepresentationandclasslabel                 |     |     |
| --- | ------------ | --- | ---------------------------------------------- | --- | --- |
|     | x 0 ,z       |     | rootpointofTaylorExpansion,rootpointcandidates |     |     |
|     | α,b          |     | learnedmodelparameters                         |     |     |
|     | k(x i ,x i0) |     | kernelfunction                                 |     |     |
|     | d,V          |     | counterandnumberofBoW-dimensions               |     |     |
|     | Rð3Þ         |     | (approximate)contributionofBoW-dimensiond      |     |     |
d
|     | Rð2Þ |     | localfeaturerelevance |     |     |
| --- | ---- | --- | --------------------- | --- | --- |
l
|     | Rð1Þ |     | pixel-wisedecompositionsperpixelq |     |     |
| --- | ---- | --- | --------------------------------- | --- | --- |
q
|     | m(l) |     | mappingfunctionbetweenlocalfeatureslandBoW |     |     |
| --- | ---- | --- | ------------------------------------------ | --- | --- |
l,l0
localfeaturedescriptors
|     | Z(x)    |     | thesetofunmappeddimensionsofaBoWdatapointx |     |     |
| --- | ------- | --- | ------------------------------------------ | --- | --- |
|     | area(l) |     | thesetofpixelcoordinatescoveredbyl         |     |     |
doi:10.1371/journal.pone.0130140.t001
functionsk((cid:3),(cid:3)),andSVMmodelparametersbandα.
i
X
S
|     |     | fðxÞ¼bþ | aykðx;xÞ |     | ð20Þ |
| --- | --- | ------- | -------- | --- | ---- |
i i i
i¼1
Thisassumptioncanbeextendedwithoutlossofgeneralitytoapproachesusingmultipleker-
nelfunctionssuchasmultiplekernellearning[45–49],structuralpredictionapproacheswith
tensorproductstructurebetweenfeaturesandlabelsasintaxonomy-basedclassifiers[50–52]
orboosting-likeformulationsasin[53]
XX
S K
;x Þ:
|     |     | fðxÞ¼bþ | a i;u k ðx |     | ð21Þ |
| --- | --- | ------- | ---------- | --- | ---- |
u iðuÞ ðuÞ
i¼1 u¼1
AnoverviewovernotationsusedfortheBagofWordsfeaturesisgiveninTable1.
Overviewofthedecompositionsteps
Themaincontributionofthispartistheformulationofagenericframeworkforretracingthe
originsofadecisionmadebythelearnedkernel-basedclassifierfunctionforaBoWfeature.
Thisisachieved,inabroadsenseasvisualizedinFig4,byfollowingtheconstructionofaBoW
representationxofanimageandtheevaluationthereofbyaclassifierfunctioninreversedirec-
tion.Inthissectionwewillderiveadecompositionofakernel-basedclassifierpredictioninto
contributionsofindividuallocalfeaturesandfinallysinglepixels.Theproposedapproachcon-
sistsofthreeconsecutivesteps.
Inthefirststepwewilluse,dependingonthetypeofkernel,eithertheTaylor-typedecom-
positionstrategyorthelayer-wiserelevancepropagationstrategy.Inthefirststeprelevance
scoresRð3ÞforthethirdlayeroftheBoWfeatureextractionprocessareobtained,describingthe
d
influenceofallBoWfeaturedimensionsdbydeconstructingtheclassifierpredictionfunctionf
P
(x)suchthat Rð3Þ (cid:2)fðxÞ.Inotherwords,wegainadecompositionintocontributionsRð3Þ
|     | d d |     |     |     | d   |
| --- | --- | --- | --- | --- | --- |
describingf(x)asasumofindividualpredictionsforalldimensionsofx.
Inthesecondstepwewillapplythelayer-wiserelevancepropagationstrategyinorderto
obtainrelevancescoresRð2ÞforthelocalfeatureslfromtherelevancescoresRð3Þ.Layer-wiserel-
|     |                              | l P  | P                        | d   |     |
| --- | ---------------------------- | ---- | ------------------------ | --- | --- |
|     | evancepropagationensuresthat | Rð2Þ | ¼ Rð3Þ (cid:2)fðxÞholds. |     |     |
l l d d
| PLOSONE|DOI:10.1371/journal.pone.0130140 | July10,2015 |     |     |     | 12/46 |
| ---------------------------------------- | ----------- | --- | --- | --- | ----- |

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
Fig4.Localandglobalpredictionsforinputimagesareobtainedbyfollowingaseriesofstepsthroughtheclassification-andpixel-wise
decompositionpipelines.Eachsteptakentowardsthefinalpixel-wisedecompositionhasacomplementinganaloguewithintheBagofWordsclassification
pipeline.Thecalculationsusedduringthepixel-wisedecompositionprocessmakeuseofinformationextractedbythosecorrespondinganalogues.Airplane
imageinthegraphicbyPixabayusertpsdave.
doi:10.1371/journal.pone.0130140.g004
Thethirdstepdescribesthecomputationofpixel-wisescoresRð1Þfromlocalfeaturerele-
q
vancescoresRð2Þ,whicharethenvisualizedasheatmapsbycolor-coding.
l
Stepone:relevancescoresRð3ÞforthethirdlayeroftheBoWfeatureextractionpro-
d
cess. ThethirdlayeristheBoWfeatureitself.Inthefirststepwewouldliketoachievea
decompositionoftheclassifierpredictionf(x)intorelevancescoresRð3ÞforBoWfeature
d
dimensiond.
X
V
fðxÞ(cid:2) Rð3Þ ð22Þ
d
d¼1
Theworkof[34]hasperformedthisstepforthespecialcaseofonesinglehistograminter-
sectionkernel.Suchadecompositioncanbegeneralizednaturallyandperformedwithout
errorforallkernelfunctionswhicharesum-decomposablealonginputdimensions.Wedefine
akernelfunctionktobesum-decomposableifthereexistskernelfunctionsk(d)actingonsingle
inputfeaturedimensionssuchthat
X
kðx;x Þ¼ kðdÞðx ;x Þ
i i0 iðdÞ i0ðdÞ ð23Þ
ðdÞ
Inthiscase,aswiththelinearandhistogramintersectionkernel,wecanachieveEq(22)with
equalityinthefollowingdefinitionbyapplyinglayer-wiserelevancepropagationwhichresults
inEq(24).
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 13/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
Def.1Relevancescoresforsumdecomposablekernels
X S
|     |     |     |      | b   |            |          | ;x  |      |
| --- | --- | --- | ---- | --- | ---------- | -------- | --- | ---- |
|     |     |     | Rð3Þ | ¼   | þ aykðdÞðx |          | Þ   | ð24Þ |
|     |     |     | d    | V   |            | i i iðdÞ | ðdÞ |      |
i¼1
ForthecaseofageneraldifferentiablekernelweapplytheTaylor-typedecompositionstrat-
egyinordertolinearlyapproximatethedimensionalcontributionsRð3Þ.Theapproximated
d
dimensionalcontributionscanbeexpressedasinEq(25).
Def.2Relevancescoresfordifferentiablekernels
|     |     |      |     |               |       | X S @kðx;(cid:3)Þ |        |      |
| --- | --- | ---- | --- | ------------- | ----- | ----------------- | ------ | ---- |
|     |     | Rð3Þ |     | := ðx(cid:5)x | Þ     | ay                | i ðx Þ | ð25Þ |
|     |     |      | d   |               | 0 ðdÞ | i i               | @x 0   |      |
|     |     |      |     |               |       | i¼1               | ðdÞ    |      |
Steptwo:relevancescoresRð2ÞforthesecondlayeroftheBoWfeatureextractionpro-
l
cess. Thesecondlayerarethelocalfeaturesextractedfrommanyregionsoftheimage.Inthe
secondstepwewouldliketoachieveadecompositionoftheclassifierpredictionf(x)intorele-
vancescoresRð2ÞforthelocalfeatureslbasedontherelevancesRð3Þfromthethirdlayer.
|     | l   |     |     |     |     |     | d   |     |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
Forthesakeofclarity,wedofornowstartwiththecaseofsum-pooledBoWaggregation,to
laterextendtoamoregeneralformulationforp-meanspoolingfromthispointon.
AsintroducedincontextofEq(19)m denotesthemappingprojectingtodimensiondof
(d)
theBoWspace.WedefinethesetofinputdimensionsZ(x)whichareeffectivelynotreached
bythemappingsoflocalfeaturesofanimage.Applyingthelayer-wisepropagationallowsto
definethelocalfeaturerelevancescoreRð2ÞasgiveninEq(27).
l
Def.3Localfeaturescoresforsumpooling
|     |     |     |     |     | (   |     | )   |     |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
X
|     |     |     | ZðxÞ¼ |     | d j | m ðlÞ¼0 |     | ð26Þ |
| --- | --- | --- | ----- | --- | --- | ------- | --- | ---- |
ðdÞ
l
|     |     |      |     | X       |       |        | X        |      |
| --- | --- | ---- | --- | ------- | ----- | ------ | -------- | ---- |
|     |     |      |     |         | m     | ðlÞ    | 1        |      |
|     |     | Rð2Þ |     |         | Rð3ÞP | ðdÞ    | Rð3Þ     |      |
|     |     |      | :=  |         |       | þ      |          | ð27Þ |
|     |     | l    |     |         | d     | m ðl0Þ | d jfl0gj |      |
|     |     |      |     | d2=ZðxÞ | l0    | ðdÞ    | d2ZðxÞ   |      |
Thecoarsestructureofdefinition(27)canbeexplainedastakingtherelevancesfromthe
layeraboveandweightingthemwiththeoutputsfromthelayerbelow.Thesummationsover
themappingsm (l)overthelocalfeatures{l}inEq(27)achieveaweightingoftherelevance
(d)
fromthethirdlayerproportionaltotheratiosofthemappings.Thesecondpartdescribesan
equaldistributionofthoserelevancescoresRð3ÞwhichcorrespondtodimensionsoftheBagof
d
Wordsfeaturexwhichhaveavalueofzeroandyetmaycontributetotheclassifierprediction.
Toseethisconsidercomputingtheχ2-kernelvaluetoasupportvectorwhichhasanon-zero
valueinthesamefeaturedimension.ThisisnecessarytoensurethatthepropagationEq(2)
holds.
SummingthelocalfeaturerelevancescoresRð2ÞfromEq(27)yieldstheTaylorapproxima-
l
tionRð3Þofthepredictionscoref(x)inEqs(24)or(25).Thispropertyisthekeytoour
d
approach.Weobtainexactsummationtothepredictionf(x)inthecaseofsumdecomposable
kernelsandusageofEq(24)inthisspecialcase.
|     |     |     |     | X    | X V |                  |     |      |
| --- | --- | --- | --- | ---- | --- | ---------------- | --- | ---- |
|     |     |     |     | Rð2Þ | ¼   | Rð3Þ (cid:2)fðxÞ |     | ð28Þ |
|     |     |     |     | l    |     | d                |     |      |
|     |     |     |     | l    | d¼1 |                  |     |      |
Wewouldliketopointoutthatthispropertyholdsalsointhecasewhenmappingsm can
(d)
| PLOSONE|DOI:10.1371/journal.pone.0130140 | July10,2015 |     |     |     |     |     |     | 14/46 |
| ---------------------------------------- | ----------- | --- | --- | --- | --- | --- | --- | ----- |

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
becomenegativeasaconsequenceofthedefinitionusedin(26)and(27),ascanbeseenfrom
thesummationgivenintheappendix.ForthatreasonourapproachisalsoapplicabletoFisher
vectors[11]andregularizedcodingapproaches[12–14].Furthermorenotethatdefinition(27)
hasnoexplicitdependenceonthewayhowthelocalfeaturesarepooledinEq(19)andthis
mightbeinappropriateweightingformax-poolingorgeneralp-meanspooling.
Wecanextendthisdefinitiontoreflecttheusageofp-meanspooling
|     |     |     |             |     | !     |      |
| --- | --- | --- | ----------- | --- | ----- | ---- |
|     |     |     |             |     | X 1=p |      |
|     |     |     |             |     | 1 n   |      |
|     |     |     | M ðx ;...;x | Þ ¼ | xp    | ð29Þ |
|     |     |     | p 1         | n   | i     |      |
n
i¼1
whichmayyielddifferentresultsinpredictionandlocaldecompositionthansumpooling.The
extensioniswell-definedfornon-negativemappingsm
(cid:7)0andanyvalueofpandforarbi-
(d)
trarymappingswhencombinedwithavalueofpfromthenaturalnumbers.
Def.4Localfeaturescoresforp-meanspooling
|     |     |     |     | (   | )   |     |
| --- | --- | --- | --- | --- | --- | --- |
X
|     |     |     | ZðpÞðxÞ¼ | d j mp | ðlÞ¼0 | ð30Þ |
| --- | --- | --- | -------- | ------ | ----- | ---- |
ðdÞ
l
|     |     |      | X   | mp ðlÞ    | X             |      |
| --- | --- | ---- | --- | --------- | ------------- | ---- |
|     |     |      |     | Rð3ÞP ðdÞ | 1             |      |
|     |     | Rð2Þ | :=  |           | þ Rð3Þ        | ð31Þ |
|     |     | l    |     | d mp      | ðl0Þ d jfl0gj |      |
l0 ðdÞ
|     |     |     | d2=ZðpÞðxÞ |     | d2ZðpÞðxÞ |     |
| --- | --- | --- | ---------- | --- | --------- | --- |
ThefirstquotientinEq(31)convergestoanindicatorfunctionforthemaximalmapping
elementinthelimitp!1whichisconsistenttomax-pooling
mp
ðlÞ
|     |     |     | P ðdÞ | !I                 | ðlÞ | ð32Þ |
| --- | --- | --- | ----- | ------------------ | --- | ---- |
|     |     |     | mp    | fargmaxl0mðdÞðl0Þg |     |      |
ðl0Þ
l0 ðdÞ
Stepthree:relevancescoresRð1ÞforthefirstlayeroftheBoWfeatureextractionpro-
q
cess. Thefirstlayerarethepixelsoftheimage.Inordertocalculatescoresforeachpixelwe
makeuseofinformationregardinglocalfeaturegeometryandlocationknownfromthelocal
featureextractionphaseatthebeginningoftheimageclassificationpipeline.Thepixelscore
Rð1Þofanimagecoordinateqiscalculatedasasumoflocalfeaturescoresofalllocalfeaturesl
q
coveringq,weightedbythenumberofpixelscoveredbyeachlocalfeaturel.Intermsoflayer-
wiserelevancepropagationalocalfeatureisacomputationunitwhichhasasmuchinputsas
thenumberofpixelsitiscovering.Withoutassumptionofanyfurtherstructurewedistribute
therelevanceofthelocalfeatureequallytoallitscoveredpixels.Layer-wisepropagationyields
Eq(34).
|     |     |     | LðqÞ¼fl | j q2areaðlÞg |     | ð33Þ |
| --- | --- | --- | ------- | ------------ | --- | ---- |
X
Rð2Þ
|     |     |     | Rð1Þ | ¼   | l   |     |
| --- | --- | --- | ---- | --- | --- | --- |
ð34Þ
|     |     |     | q   | jareaðlÞj |     |     |
| --- | --- | --- | --- | --------- | --- | --- |
l2LðqÞ
Theoperatorarea(l)usedEqs(33)and(34)returnsthesetofpixelcoordinatescoveredbya
localfeaturel.ProjectingtheobtainedscoresRð1Þtotheirrespectiveimagecoordinatesyields
q
thepixel-wisedecompositionrepresentationhoftheevaluatedimage.
| PLOSONE|DOI:10.1371/journal.pone.0130140 | July10,2015 |     |     |     |     | 15/46 |
| ---------------------------------------- | ----------- | --- | --- | --- | --- | ----- |

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
Forvisualizationinthesenseofcolorcoding,thepixel-wisedecompositionR(1)isthennor-
malizedas
Rð1Þ
R q 0ð1Þ ¼ maxð q jRð1ÞjÞ ð35Þ
q0
q0
ensuringthat8q:R0ð1Þ 2½(cid:5)1;1(cid:6).Thenormalizedpixel-wisedecompositionisthencolor
q
codedbymappingthepixelscorestoacolorspaceofchoice.Inthecaseofindividuallyclassi-
fiedsub-regionsoriginatingfromthesameimage,aglobalpixel-wisedecompositioncanbe
constructedbyaveraginglocalpixel-wisedecompositionsscores.
Notethatbychoosingabovenormalizationscheme,theassumptionismadethatatleast
oneclassisrepresentedwithintheimage.Incasetheassumptionholdsthismightleadto
prominentlocalpredictionsofevenweaklyprojectedfeatureswhichwefoundsuitableforthe
purposeofdetectingclassevidence.Ifthisassumptiondoesnothold,thenimagesmaydisplay
scoreartifactsdominatedbythesetofpixelscoveredbyasmallsubsetoflocalfeatureswhich
wouldotherwisebeconsideredinputnoise.Asolutionforthisproblemisglobalnormalization
whichusesamaximumoverpixelsoverasetofimagesinsteadofoneimage.Wefoundthata
globalnormalizationschemecanbemoreappropriateforvisualizingtheactualdecisionpro-
cessoftheclassifier,asitpreservestherelativeorderofmagnitudeoflocalfeaturescoresin
betweenpixel-wisedecompositiontiles.Algorithm1givesanoverviewhowtocomputethe
pixel-wisedecompositionforclassifiersbasedonBagofWordsfeaturesandsupportvector
machines.
Algorithm1Pixel-wisedecompositionforBoWfeatureswithSVMclassifiers
Inputs:
ImageI
LocalfeaturesL
BoWrepresentationx(andTaylorrootpointx )
0
modelandmappingparameters
ford=1toVdo
Rð3ÞasinEqs(24)or(25)
d
endfor
foralll2Ldo
Rð2ÞasinEqs(27)or(31)
l
endfor
forallpixelsq2Ido
Rð1ÞasinEq(34)
q
endfor
Output:8q: Rð1Þ
q
Examplesforvariousmappingsandkernels
Inordertoillustratethegeneralityofthisframeworkwegivesomeexamplesforvariousmeth-
odsofmappinglocalfeaturesandkernels.
Examplecase:Softcodebookmapping. Asoftcodebookmappinglikein[15,40]fitstriv-
iallyintotheframework
expð(cid:5)bdðl;b ÞÞ
m ðlÞ¼ P d ð36Þ
ðdÞ expð(cid:5)bdðl;b ÞÞ
ðdÞ d
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 16/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
|     | Examplecase:Regularizedcoding. |     |     | Consideringformulationsasin[12,14] |     |     |
| --- | ------------------------------ | --- | --- | ---------------------------------- | --- | --- |
X
|     |     |     | argmin | kl (cid:5)Bc k2þQðcÞ |     |      |
| --- | --- | --- | ------ | -------------------- | --- | ---- |
|     |     |     | B;C    |                      |     | ð37Þ |
j j j
j
whereBisthecodebookandQdenotesaregularizeronthecodebookcoefficientssuchasthe
ℓ -normQ(c)=∑jc(j)j,wearriveat
|     | 1   | j   |         |     |     |      |
| --- | --- | --- | ------- | --- | --- | ---- |
|     |     |     | mðlÞ:¼c |     |     | ð38Þ |
j j
wherethed-thdimensionofthesodefinedmappingm
(d) correspondstothed-thbasiselement
inB.
Examplecase:FisherVectors. TheFishervector[44]canbereplicatedusingthefollowing
mappingm givenbelow.Itisexpectedtobeusedwithalinearkernel,thuswecanusethe
(d)
exactformulafromEq(24)fordefiningtheBoWdimensionrelevancescoresRð3Þ.Westickto
d
theformulationofFishervectorsasgivenin[11].Thedifferencetoothermappingsisthata
BoWfeaturedimensioncorrespondstoaderivativeofaGaussianmixturecenterwithrespect
tosomeparameterandnottoavisualword.
(l)betheD-dimensionalGaussianmixturecomponentwithdiagonalcovarianceσ
Letg
|     |          | k                                             |     |     |     | k   |
| --- | -------- | --------------------------------------------- | --- | --- | --- | --- |
|     | andmeanμ | .WedefinethesoftmaxoftheGMMmixtureparametersα |     |     | as  |     |
|     |          | k                                             |     |     | k   |     |
expða Þ
|     |     |     | w ¼P | k   |     |     |
| --- | --- | --- | ---- | --- | --- | --- |
ð39Þ
|     |     |     | k   | K expðaÞ |     |     |
| --- | --- | --- | --- | -------- | --- | --- |
j¼1 j
LetthesoftassignmentoflocalfeatureltoGaussiankbegivenas
w u ðlÞ
|     |     |     | g½l(cid:6)ðkÞ¼P | k k |     |     |
| --- | --- | --- | --------------- | --- | --- | --- |
ð40Þ
K wuðlÞ
j¼1 j j
LetkdenotetheindexofaGaussianmixturecomponent,thenthemappingcontainsthree
casesdependingonwhetherweconsiderthederivativeforthemixtureparameterα
k storedin
dimensiond=(2D+1)(k−1)+1,derivativesfortheGaussianmeanparameterμ storedin
k
dimensionsd=(2D+1)(k−1)+1+r,r2[1,D],orfinally,derivativesfortheGaussianvari-
|     | anceparameterσ | storedindimensionsd=(2D+1)(k−1)+1+D+r,r2[1,D] |     |     |     |     |
| --- | -------------- | --------------------------------------------- | --- | --- | --- | --- |
k
Weassumeonekernelwithoutlossofgenerality,V =(2D+1)KwhereKisthenumberof
1
GaussianmixturecomponentsandDisthelocalfeaturedimension.
8
>>>>>>>>>>< 1
|     |     | p ffi ffiffiffi ffiðg½l(cid:6)ðkÞ(cid:5)w | Þ   | if d¼ð2Dþ1Þðk(cid:5)1Þþ1 |     |     |
| --- | --- | ----------------------------------------- | --- | ------------------------ | --- | --- |
|     |     | w                                         | k   |                          |     |     |
k
|     |        | 1 l                           | (cid:5)m | d¼ð2Dþ1Þðk(cid:5)1Þþ1þr;r2½1;D(cid:6) |     |      |
| --- | ------ | ----------------------------- | -------- | ------------------------------------- | --- | ---- |
|     | m ðlÞ¼ | pffiffiffiffiffig½l(cid:6)ðkÞ | r k      | if                                    |     | ð41Þ |
|     | ðdÞ    | >>>>>>>>>>: w                 | s        |                                       |     |      |
|     |        | k                             | k        |                                       |     |      |
|     |        |                               | (cid:3)  | (cid:4)                               |     |      |
Þ2
|     |     | 1                                | 1 ffi ffiffi ðl (cid:5)m | d¼ð2Dþ1Þðk(cid:5)1Þþ1þDþr;r2½1;D(cid:6) |     |     |
| --- | --- | -------------------------------- | ------------------------ | --------------------------------------- | --- | --- |
|     |     | p ffiffiffiffi ffig½l(cid:6)ðkÞp | r k (cid:5)1             | if                                      |     |     |
|     |     | w                                | 2 s2                     |                                         |     |     |
|     |     | k                                | k                        |                                         |     |     |
Thisdefinitioncanbeextendedinastraightforwardmannertousepowernormalizationand
ℓ normalizationfrom[11].ThedifferencetothesoftmappingcasefromSectionExample
2
case:Softcodebookmappingisthatathed-thdimensionofthemappingm correspondsnot
(d)
toavisualwordbuttoaderivativewithrespecttoaGaussianmixturecomponent.
| PLOSONE|DOI:10.1371/journal.pone.0130140 | July10,2015 |     |     |     |     | 17/46 |
| ---------------------------------------- | ----------- | --- | --- | --- | --- | ----- |

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
Examplecase:Histogramintersectionkernel. Thehistogramintersectionkernelapplies
totheexactdecompositionformulainEq(24).Itisdefinedas
X
|     |     |     |     | ðx;x |      |       |      | ;x    |     |      |
| --- | --- | --- | --- | ---- | ---- | ----- | ---- | ----- | --- | ---- |
|     |     |     |     | k    | Þ¼   | minðx |      | Þ     |     | ð42Þ |
|     |     |     |     | HI   | i i0 |       | iðdÞ | i0ðdÞ |     |      |
d
Pluggingthekernelinto(24)yields
|     |     |     |     |      |     | X   | (cid:5) | (cid:6)  |     |      |
| --- | --- | --- | --- | ---- | --- | --- | ------- | -------- | --- | ---- |
|     |     |     |     |      | b   | S   |         |          |     |      |
|     |     |     |     | Rð3Þ |     |     |         | ;x       |     |      |
|     |     |     |     | ¼    | þ   | ay  | min x   |          |     | ð43Þ |
|     |     |     |     | d    | V   | i i |         | iðdÞ ðdÞ |     |      |
i¼1
Examplecase:χ2kernel
Theχ2kernelfunctionhasbeenappliedwithgoodperformanceinvariousimageclassification
tasks[41,54,55].Theχ2kernelisdefinedas
|     |     |     |     |      |        |          |        |          | !   |      |
| --- | --- | --- | --- | ---- | ------ | -------- | ------ | -------- | --- | ---- |
|     |     |     |     |      |        |          | X      |          | Þ2  |      |
|     |     |     |     |      |        |          | ðx     | (cid:5)x |     |      |
|     |     |     | k   | ðx;x | Þ¼ exp | (cid:5)s | iðdÞ   | i0ðdÞ    |     | ð44Þ |
|     |     |     | w2  | i0   |        |          |        |          |     |      |
|     |     |     |     | i    |        |          | ðx     | þx       | Þ   |      |
|     |     |     |     |      |        |          | d iðdÞ | i0ðdÞ    |     |      |
Toavoiddivisionsbyzeroincaseofx =x =0weadheretotheconventionthat0 ¼0for
|     |     |     |     |     | i(d) | i0(d) |     |     |     |     |
| --- | --- | --- | --- | --- | ---- | ----- | --- | --- | --- | --- |
0
thekernelfunctionitself,aswellasitsderivative
|     |     |     |     |       |       |     |      |       | !        |      |
| --- | --- | --- | --- | ----- | ----- | --- | ---- | ----- | -------- | ---- |
|     |     |     | @k  | ðx;x  |       |     |      |       |          |      |
|     |     |     |     | Þ     |       |     | 4ðx  | Þ2    |          |      |
|     |     |     | w2  | i i0  | ðx;x  | Þs  |      | iðdÞ  |          |      |
|     |     |     | @x  |       | ¼k w2 | i0  |      |       | (cid:5)1 | ð45Þ |
|     |     |     |     |       |       | i   | ðx   | þx Þ2 |          |      |
|     |     |     |     | i0ðdÞ |       |     | iðdÞ | i0ðdÞ |          |      |
WhenpluggedintoEq(25),thedimensionalcontributionsoftheχ2kernelarethenobtained
as
|     |     |      |              |     |             |        |     |       | !        |      |
| --- | --- | ---- | ------------ | --- | ----------- | ------ | --- | ----- | -------- | ---- |
|     |     |      |              |     | X           |        |     |       | Þ2       |      |
|     |     |      |              |     | S           |        |     | 4ðx   |          |      |
|     |     | Rð3Þ | :¼ðx(cid:5)x | Þ   | (cid:3) ayk | ðx;x   | Þs  | iðdÞ  | (cid:5)1 | ð46Þ |
|     |     | d    |              | 0   |             | i i w2 | i 0 |       | Þ2       |      |
|     |     |      |              | ðdÞ |             |        |     | ðx þx |          |      |
|     |     |      |              |     | i¼1         |        |     | iðdÞ  | 0ðdÞ     |      |
Examplecase:Gaussian-RBFkernel. TheGaussian-RBFkernelfunctioniswidelyusedin
differentcommunitiesandisoneofthemostprominent,ifnotthemostprominentnon-linear
kernelfunction.Thekernelfunctionisdefinedas
|     |                                 |     |       |       |                                     | (cid:3) |           |             | (cid:4) |      |
| --- | ------------------------------- | --- | ----- | ----- | ----------------------------------- | ------- | --------- | ----------- | ------- | ---- |
|     |                                 |     |       |       |                                     |         | kx        | (cid:5)x k2 |         |      |
|     |                                 |     |       | ðx;x  |                                     |         |           | i0          |         |      |
|     |                                 |     |       | k     | Þ¼                                  | exp     | (cid:5) i | 2           |         | ð47Þ |
|     |                                 |     |       | Gauss | i i0                                |         |           | s           |         |      |
|     | Derivingthekernelfunctionw.r.tx |     |       |       | i0(d) andpluggingitintoEq(25)yields |         |           |             |         |      |
|     |                                 |     |       |       |                                     |         | (cid:3)   |             | (cid:4) |      |
|     |                                 |     | @k    | ðx;x  | Þ                                   |         | 2x        | (cid:5)2x   |         |      |
|     |                                 |     |       |       | i0                                  | ðx;x    |           | iðdÞ        | i0ðdÞ   |      |
|     |                                 |     | Gauss | i     | ¼k                                  |         | Þ         |             |         | ð48Þ |
|     |                                 |     |       | @x    |                                     | Gauss i | i0        | s           |         |      |
i0ðdÞ
andconsequently
|     |     |     |     |     |     |     |     | (cid:3) | (cid:4) |     |
| --- | --- | --- | --- | --- | --- | --- | --- | ------- | ------- | --- |
X
|     |     |      |              |     | S         |           |      | 2x   | (cid:5)2x |      |
| --- | --- | ---- | ------------ | --- | --------- | --------- | ---- | ---- | --------- | ---- |
|     |     | Rð3Þ | :¼ðx(cid:5)x |     |           | ayk       | ðx;x | iðdÞ | 0ðdÞ      |      |
|     |     |      |              |     | Þ (cid:3) |           |      | Þ    |           | ð49Þ |
|     |     |      | d            | 0   | ðdÞ       | i i Gauss | i    | 0    | s         |      |
i¼1
| PLOSONE|DOI:10.1371/journal.pone.0130140 | July10,2015 |     |     |     |     |     |     |     |     | 18/46 |
| ---------------------------------------- | ----------- | --- | --- | --- | --- | --- | --- | --- | --- | ----- |

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
Pixel-wiseDecompositionforMultilayerNetworks
Multilayernetworksarecommonlybuiltasasetofinterconnectedneuronsorganizedina
layer-wisemanner.Theydefineamathematicalfunctionwhencombinedtoeachother,that
mapsthefirstlayerneurons(input)tothelastlayerneurons(output).Wedenoteeachneuron
byx whereiisanindexfortheneuron.Byconvention,weassociatedifferentindicesforeach
i
layerofthenetwork.Wedenoteby“∑”thesummationoverallneuronsofagivenlayer,and
i
by“∑”thesummationoverallneuronsofanotherlayer.Wedenotebyx theneuronscorre-
j (d)
spondingtothepixelactivations(i.e.withwhichwewouldliketoobtainadecompositionof
theclassificationdecision).Acommonmappingfromonelayertothenextoneconsistsofa
linearprojectionfollowedbyanon-linearfunction:
z ¼xw ; ð50Þ
ij i ij
X
z ¼ z þb;
j ij j ð51Þ
i
x ¼gðzÞ; ð52Þ
j j
wherew isaweightconnectingtheneuronx toneuronx,b isabiasterm,andgisanon-lin-
ij i j j
earactivationfunction.Multilayernetworksstackseveraloftheselayers,eachofthem,com-
posedofalargenumberofneurons.Commonnon-linearfunctionsarethehyperbolictangent
g(t)=tanh(t)ortherectificationfunctiong(t)=max(0,t).Thisformulationofneuralnetwork
isgeneralenoughtoencompassawiderangeofarchitecturessuchasthesimplemultilayerper-
ceptron[56]orconvolutionalneuralnetworks[57],whereconvolutionandsum-poolingare
linearoperations.
Taylor-typedecomposition
Denotingbyf:RM!7 RNthevector-valuedmultivariatefunctionimplementingthemapping
betweeninputandoutputofthenetwork,afirstpossibleexplanationoftheclassificationdecision
x!7 f(x)canbeobtainedbyTaylorexpansionatanearrootpointx ofthedecisionfunctionf:
0
@f
Rð1Þ ¼ðx(cid:5)x Þ (cid:3) ðx Þ ð53Þ
d 0 ðdÞ @x 0
ðdÞ
Thederivative@f(x)/@x requiredforpixel-wisedecompositioncanbecomputedefficientlyby
(d)
reusingthenetworktopologyusingthebackpropagationalgorithm[56].Inparticular,having
backpropagatedthederivativesuptoacertainlayerj,wecancomputethederivativeoftheprevi-
ouslayeriusingthechainrule:
@f X@f @x X@f
@x ¼ @x (cid:3) @x j ¼ @x (cid:3)w ij (cid:3)g0ðz j Þ: ð54Þ
i j j i j j
ArequirementoftheTaylor-baseddecompositionistofindrootsx (i.e.pointsontheclas-
0
sificationboundary)thatsupportalocalexplanationoftheclassificationdecisionforx.These
rootscanbefoundbylocalsearchintheneighborhoodofx.However,asnotedin[24],this
canleadtopointsoftheinputspacethatareperceptuallyequivalenttotheoriginalsamplex
andwhosechoiceasarootwouldproducenon-informativepixel-wisedecompositions.
Alternatively,rootpointscanbefoundbylinesearchonthesegmentdefinedbyxandits
closestneighborofadifferentclass.Thissolutionisproblematicwhenthedatamanifoldis
sparselypopulated,asitisthecasefornaturalimages.Insuchcase,itislikelythatfollowinga
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 19/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
Fig5.Multilayerneuralnetworkannotatedwiththedifferentvariablesandindicesdescribingneuronsandweightconnections.Left:forwardpass.
Right:backwardpass.
doi:10.1371/journal.pone.0130140.g005
straightlinebetweenxanditsnearestneighborwillstronglydepartfromthedatamanifold
andproducerootsx withsimilarlypoorpixel-wisedecompositions.
0
Layer-wiserelevancebackpropagation
AsanalternativetoTaylor-typedecomposition,itispossibletocomputerelevancesateach
layerinabackwardpass,thatis,expressrelevancesRðlÞasafunctionofupper-layerrelevances
i
Rðlþ1Þ,andbackpropagatingrelevancesuntilwereachtheinput(pixels).Fig5depictsagraphic
j
example.
Themethodworksasfollows:KnowingtherelevanceofacertainneuronRðlþ1Þfortheclas-
j
sificationdecisionf(x),onewouldliketoobtainadecompositionofsuchrelevanceintermsof
messagessenttoneuronsofthepreviouslayers.WecallthesemessagesR .Inparticular,as
i j
expressedbyEqs(8)and(13),theconservationproperty
X
Rðl;lþ1Þ ¼Rðlþ1Þ
i j j ð55Þ
i
musthold.Inthecaseofalinearnetworkf(x)=∑ z wheretherelevanceR =f(x),suchdecom-
i ij j
positionisimmediatelygivenbyR =z .However,inthegeneralcase,theneuronactivation
i j ij
x isanon-linearfunctionofz.Nevertheless,forthehyperbolictangentandtherectifying
j j
function—twosimplemonotonicallyincreasingfunctionssatisfyingg(0)=0,—thepre-activa-
tionsz stillprovideasensiblewaytomeasuretherelativecontributionofeachneuronx toR.
ij i j
Afirstpossiblechoiceofrelevancedecompositionisbasedontheratiooflocalandglobalpre-
activationsandisgivenby:
z
Rðl;lþ1Þ ¼ ij(cid:3)Rðlþ1Þ ð56Þ
i j z j
j
TheserelevancesR areeasilyshowntoapproximatetheconservationpropertiesofEq(2),
i j
inparticular:
!
X
b
Rðl;lþ1Þ ¼Rðlþ1Þ(cid:3) 1(cid:5) j ð57Þ
i j j z
i j
wherethemultiplieraccountsfortherelevancethatisabsorbed(orinjected)bythebiasterm.
Ifnecessary,theresidualbiasrelevancecanberedistributedontoeachneuronx.
i
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 20/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
AdrawbackofthepropagationruleofEq(56)isthatforsmallvaluesz,relevancesR
|     |     |     |     |     |     |     | j   | i j |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
cantakeunboundedvalues.Unboundednesscanbeovercomebyintroducingapredefinedsta-
bilizerε(cid:7)0:
8
>< zij (cid:3)Rðlþ1Þ
z (cid:7)0
|     |     |     |     |     | zjþε | j j |     |     |
| --- | --- | --- | --- | --- | ---- | --- | --- | --- |
Rðl;lþ1Þ
|     |     |     |     | ¼   | >:  |     |     | ð58Þ |
| --- | --- | --- | --- | --- | --- | --- | --- | ---- |
i j
|     |     |     |     |     | zij        | (cid:3)Rðlþ1Þ z <0 |     |     |
| --- | --- | --- | --- | --- | ---------- | ------------------ | --- | --- |
|     |     |     |     |     | zj(cid:5)ε | j j                |     |     |
Theconservationlawthenbecomes
|     |     |     |     | 8            | (cid:5)  | (cid:6)      |     |     |
| --- | --- | --- | --- | ------------ | -------- | ------------ | --- | --- |
|     |     |     |     | >><R         |          | b þ ε        |     |     |
|     |     |     |     | ðlþ1Þ(cid:3) | 1(cid:5) | j z (cid:7)0 |     |     |
|     |     | X   |     | j            |          | zj þ ε j     |     |     |
Rðl;lþ1Þ
|     |     |     | ¼   |               | (cid:5)  | (cid:6)       |     | ð59Þ |
| --- | --- | --- | --- | ------------- | -------- | ------------- | --- | ---- |
|     |     |     | i j | >>:           |          |               |     |      |
|     |     |     |     | Rðlþ1Þ(cid:3) |          | bj(cid:5)ε <0 |     |      |
|     |     | i   |     |               | 1(cid:5) | z             |     |      |
|     |     |     |     | j             |          | zj(cid:5)ε j  |     |      |
wherewecanobservethatsomefurtherrelevanceisabsorbedbythestabilizer.Inparticular,
relevanceisfullyabsorbedifthestabilizerεbecomesverylarge.
AnalternativestabilizingmethodthatdoesnoPtleakrelevanceconsisPtsoftreatingnegative
z(cid:5)þb(cid:5)where“−”
|     | andpositivepre-activationsseparately.Letzþ |     |     |     | ¼   | zþþbþandz(cid:5) | ¼        |     |
| --- | ------------------------------------------ | --- | --- | --- | --- | ---------------- | -------- | --- |
|     |                                            |     |     |     | j   | i ij j           | j i ij j |     |
and“+”denotethenegativeandpositivepartofz
andb.Relevancepropagationisnow
|     |     |     |     |     |     | ij j |     |     |
| --- | --- | --- | --- | --- | --- | ---- | --- | --- |
definedas
|     |     |     |          |                |          | !               |     |      |
| --- | --- | --- | -------- | -------------- | -------- | --------------- | --- | ---- |
|     |     |     |          |                |          | zþ z(cid:5)     |     |      |
|     |     |     | Rðl;lþ1Þ | ¼Rðlþ1Þ(cid:3) | a(cid:3) | ij þb(cid:3) ij |     | ð60Þ |
|     |     |     | i j      | j              |          | zþ              |     |      |
z(cid:5)
|     |     |     |     |     |     | j j |     |     |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
whereα+β=1.Forexample,forα,β=1/2,theconservationlawbecomes:
|     |     |     |     |     |     | !   |     |     |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
X
|     |     |     |          |                |     | bþ b(cid:5)      |     |      |
| --- | --- | --- | -------- | -------------- | --- | ---------------- | --- | ---- |
|     |     |     | Rðl;lþ1Þ | ¼Rðlþ1Þ(cid:3) |     | j j              |     |      |
|     |     |     |          |                |     | 1(cid:5) (cid:5) |     | ð61Þ |
|     |     |     | i j      |                | j   | 2zþ 2z(cid:5)    |     |      |
|     |     |     | i        |                |     | j j              |     |      |
whichhassimilarformtoEq(57).Thisalternatepropagationmethodalsoallowstocontrol
manuallytheimportanceofpositiveandnegativeevidence,bychoosingdifferentfactorsα
andβ.
Oncearuleforrelevancepropagationhasbeenselected,theoverallrelevanceofeachneu-
roninthelowerlayerisdeterminedbysumminguptherelevancecomingfromallupper-layer
neuronsinconsistencewithEqs(8)and(13):
X
|     |     |     |     | RðlÞ | ¼ Rðl;lþ1Þ |     |     |      |
| --- | --- | --- | --- | ---- | ---------- | --- | --- | ---- |
|     |     |     |     | i    |            | i j |     | ð62Þ |
j
Therelevanceisbackpropagatedfromonelayertoanotheruntilitreachestheinputpixelsx ,
(d)
andwhererelevancesRð1Þprovidethedesiredpixel-wisedecompositionofthedecisionf(x).
d
Thecompletelayer-wiserelevancepropagationprocedureforneuralnetworksissummarized
inAlgorithm2.
Algorithm2Pixel-wisedecompositionforneuralnetworks
Input:R(L)=f(x)
forl2{L−1,...,1}do
Rðl;lþ1ÞasinEqs(58)or(60)
|     | i j P          |     |     |     |     |     |     |     |
| --- | -------------- | --- | --- | --- | --- | --- | --- | --- |
|     | RðlÞ¼ Rðl;lþ1Þ |     |     |     |     |     |     |     |
|     | i j i j        |     |     |     |     |     |     |     |
endfor
|     | Output:8d: | Rð1Þ |     |     |     |     |     |     |
| --- | ---------- | ---- | --- | --- | --- | --- | --- | --- |
d
| PLOSONE|DOI:10.1371/journal.pone.0130140 | July10,2015 |     |     |     |     |     |     | 21/46 |
| ---------------------------------------- | ----------- | --- | --- | --- | --- | --- | --- | ----- |

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
Aboveformulas(58)and(60)aredirectlyapplicabletolayerswhichsatisfyacertainstruc-
ture.Supposewehaveaneuronactivationx fromonelayerwhichismodeledasafunctionof
j
inputsfromactivationsx fromtheprecedinglayer.Thenlayer-wiserelevancepropagationis
i
directlyapplicableifthereexistsafunctiong andfunctionsh suchthat
j ij
!
X
x ¼g h ðxÞ ð63Þ
j j ij i
i
Insuchageneralcase,theweightingtermsz =xw fromEq(50)havetobereplacedaccord-
ij i ij
inglybyafunctionofh (x).Akeyobservationisthatrelevancepropagationisinvariant
ij i
againstthechoiceoffunctiong forcomputingrelevancesfortheinputsx conditionedonkeep-
j i
ingthevalueofrelevanceR forx fixed.Thisobservationallowstodealwithnon-linearactiva-
j j
tionfunctionsg.Thefunctiong doeshoweverexertinfluenceoncomputingtherelevanceR
j j i
byitsinfluenceontherelevanceR forx.Thiscanbeexplainedbythefact,thatthechoiceofg
j j j
determinesthevalueofx andthusalsorelevanceR forx whichgetsassignedbytheweights
j j j
inthelayerabove.
Weremarkagain,thatevenmaxpoolingfitsintothisstructureasalimitofgeneralized
means,seeEq(32)forexample.Forstructureswithahigherdegreeofnon-linearity,suchas
localrenormalization[58,59],Taylorapproximationappliedtoneuronactivationx canbe
j
usedagaintoachieveanapproximationforthestructureasgiveninEq(63).
Finally,itcanbeseenfromtheformulasestablishedinthissectionthatlayer-wiserelevance
propagationisdifferentfromaTaylorseriesorpartialderivatives.UnlikeTaylorseries,itdoes
notrequireasecondpointotherthantheinputimage.Layer-wiseapplicationoftheTaylor
seriescanbeinterpretedasagenericwaytoachieveanapproximateversionoflayer-wiserele-
vancepropagation.Similarly,incontrasttoanymethodsrelyingonderivatives,differentiability
orsmoothnesspropertiesofneuronactivationsarenotanecessaryrequirementforbeingable
todefineformulaswhichsatisfylayer-wiserelevancepropagation.Inthatsenseitisamore
generalprinciple.
Experiments
ForBagofWordsfeaturesweshowtwoexperiments,oneonanartificialbuteasilyinterpret-
abledatasetandoneforonPascalVOCimageswhichhaveahighcompositionalcomplexity.
FortheartificialdatasetweapplytheTaylor-typestrategyforthetoplayer,forPascalVOC
imagesweapplythestrategyforsum-decomposablekernelsforthetoplayer.Inbothcases
thesestrategiesarecombinedwithourdefinitionsforarbitrarymappingsforthelowerlayers.
Forneuralnetworksweshowresultsalsoontwodatasets,twosetsofresultsonMNIST
whichareeasytointerpret,andasecondsetofexperimentsinwhichwerelyona15layers
alreadytrainednetworkprovidedaspartoftheCaffeopensourcepackage[60],whichpredicts
the1000categoriesfromtheILSVRCchallenge.Ononeside,bytheexperimentsonMNIST
digits,weintendtoshowthatwecanuncoverdetailsspecifictothetrainingphase.Onthe
otherside,theresultsforthepre-trainednetworkfromtheCaffetoolboxdemonstrate,thatthe
methodworkswithadeepneuralnetworkoutoftheboxanddoesnotrelyonpossibletricks
duringthetrainingphase.
BagofWordsfeaturesforpolygonsversuscircles
Anexampleofapixel-wisedecompositionforsyntheticdataisgiveninFig6.Thetraining
imageswereimagetilesofsize102×102pixels.Animagewaslabeledpositiveifitcontainedat
leastonepolygonindependentofthepresenceofcircles,andlabelednegativeifitcontainedno
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 22/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
shapeorcirclesonly.TheBoWfeatureshavebeencomputedoverstandardSIFTfeatureson
grayscalebrightnessvaluesonadensegridwithscales2.0and3.0resultinginoneBoWfeature
foreachscale.TheSIFTfeaturemaskshavebeenrotatedrelativelytothemainpixelgradient
directionattheirrespectiveanchorlocations.Oneχ2-kernelasinEq(44)wasusedforeach
BoWfeatureinconjunctionwithmultiplekernellearning.ThereforetheTaylor-typedecom-
positionwasusedforcomputingthethirdlayerrelevancesRð3ÞbyEq(46).The128-dimen-
d
sionalBoWfeaturesarecomputedusingasum-pooledrank-mappingparadigm
X
M
x ¼M(cid:5)1 m ðlÞ
ðdÞ ðdÞ j
j¼1
(
p(cid:5)rkdðlÞ ;rk ðlÞ(cid:4)n
d
m ðlÞ¼ ð64Þ
ðdÞ
0 ;else
followedbyanℓ -normalizationofx.Similarasin[41]wesetp=2andn=4.Theexpression
1
rk (l)inFormula(64)describestherankoftheBoWprototyperepresentingdimensiondin
d
theBoWfeaturespaceamongascendinglyorderedEuclideandistancesbetweenlandallBoW
prototypes.ThusFormula(27)basedonlayer-wiserelevancepropagationwasusedtoobtain
predictionsRð2Þ.InordertocomputethevisualizationinFig6,thetestpicturewasdividedinto
l
Fig6.Pixel-wisedecompositionforBagofWordsfeaturesoverχ2-kernelsusingtheTaylor-typedecompositionforthethirdlayerandthelayer-
wiserelevancepropagationforthesubsequentlayers.Left:Theoriginalimage.Middle:Pixel-wiseprediction.Right:Superpositionoftheoriginalimage
andthepixel-wiseprediction.Thedecompositionswerecomputedontilesofsize102×102andhavingaregularoffsetof34pixels.Thedecompositions
fromtheoverlappingtileswereaveraged.Intheheatmap,basedonlinearlymappingtheinterval[−1,+1]tothejetcolormapavailableinmanyvisualization
packages,greencorrespondstoscoresclosetozero,yellowandredtopositivescoresandbluecolortonegativescores.Seetextforinterpretation.
doi:10.1371/journal.pone.0130140.g006
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 23/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
tilesofsizes102×102withagridstepof34pixels.Foreachimagetileonepixel-wisedecom-
positionwascomputed.Theoverlappingpixel-wisedecompositionswereaveraged,theresult-
ingheatmapwasnormalizedtotherange[−1,+1]bydividingitbythemaximalabsolutepixel
value.
TheaveragedclassifierdecompositioninFig6showsfirstlythatthepixel-wisedecomposi-
tionachievedbycombiningbothdecompositionstrategiesyieldsplausibleresults.Theclassi-
fiermakingpredictionsontileswastrainedtodiscriminatepolygonsversuscircles.The
heatmapvisualizationofthepixel-wisedecompositionisconsistentwiththatresult:Pixels
closetopolygonsachievepositivepixel-wisescores,visiblebytheyellowtoredcolors.Pixels
closetocirclesaremappedinlightbluecolorscorrespondingtonegativepixel-wisescores.Pix-
elsfarawayfromshapesareingreenwhichencodesscoresclosetozero.
Thisobservationimpliesthatlocalfeaturesoverpolygonsareprovidedonaveragewithpos-
itivesecondlayerscoresRð2Þ (cid:8)0andlocalfeaturesovercirclesreceiveonaverageweaklyneg-
l
ativesecondlayerscoresRð2Þ <0.Furthermoreregionswhicharefarfromshapesresultin
l
scoresclosetozerowhicharecoloredingreenintheheatmapfrompixel-wisedecomposition
ofthepredictionsandintheoverlayoftheimageandthedecomposition.Weremarkthatthe
shapeshavearbitrarypositionsintheimagetilesofthetrainingsetandthatpositioninforma-
tionwasneverusedduringtrainingorBoWfeatureextractions.Thus,thepixel-wisedecompo-
sitionisabletodetectstructuresonasmallerscalethantheclassifierwastrainedonalthough
positioninformationwasneverprovidedduringtrainingorusedintheclassificationalgorithm
whichmapsanimagetiletoareal-valuedclassifierprediction.Theresolutionofthesmaller
scaleislimitedbythescaleoftheSIFTfeaturesusedhere,thescale3.0resultsinaSIFTfeature
withsidelengthof4(cid:3)3(cid:3)3=36pixels.Thisexplainsalsowhypixelscoresoutsideofashape
butnearbytoashapereceivethecolorwhichcorrespondstothelabelinducedbytheneighbor-
ingshape.
Finallyweremarkthattherank-mappingisadiscontinuousweightingschemeforBoWfea-
turedimensions,yetthelayer-wisepropagationyieldsreasonableexplanations.
BagofWordsfeaturesforthePascalVOC2009dataset
Wehavecalculatedpixel-wisepredictionsforimagesfromtheevaluationsetofthePascal
VOC2009imageclassificationchallenge.TheBoWrepresentationsofthetrainingandtest
partofthedatasethavebeencomputedoverwholeimagesbasedonlocalfeaturesextracted
fromadenseregulargridandfixedrotation.StandardSIFTfeaturesandstacksof9-dimen-
sionalquantilefeaturesmeasuringvaluesfrom0.1to0.9ofthedataovercolorintensitiesasin
[41]havebeenusedatlocalfeaturescale3.0.Thequantilefeaturesaresplitintotworegions
describinghalvesofacircle,yieldingone9-dimensionalquantileovercolorintensitieseach,
whicharethenconcatenated.TheSIFTfeaturedescriptorshavebeencomputedonceovera
grayscaleversionoftheimage,stackedwithfeaturedescriptorscomputedoveracombination
ifopposingcolorchannelsredþgreen(cid:5)2(cid:3)blueþ2,resultingina128+128=256dimensionallocalfea-
4
turevector.ForSIFTaswellasthecolorintensityquantiles,thesameprocedurehasbeen
appliedtothered,greenandbluecolorchannelsoftheimagesseparately,resultingin
128(cid:3)3=384and(2(cid:3)9)(cid:3)3=54dimensionsforthelocalfeaturesrespectively.SIFTandquantile
featuresweremappedonto1024dimensionaland512dimensionalBoWspacesrespectively,
usingtherankedmappingschemeinFormula(64)withp=2.4andn=8.Classifierswere
trainedfordetectingthepresenceofthetargetobjectcategoryregardlessofthepresenceof
otherclasses,usingmultiplekernellearningonthreehistogramintersectionkernels,onefor
eachcomputedlocalfeatureconfiguration.Consequently,thelayer-wiserelevancepropagation
Formulas(24)and(27)wereusedtocomputelocalpredictionsforeachevaluationimageasa
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 24/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
Fig7.Pixel-wisedecompositionforBagofWordsfeaturesoverahistogramintersectionkernelusingthelayer-wiserelevancepropagationforall
subsequentlayersandrank-mappingformappinglocalfeatures.Eachtripletofimagesshows—fromlefttoright—theoriginalimage,thepixel-wise
predictionssuperimposedwithprominentedgesfromtheinputimageandtheoriginalimagesuperimposedwithbinarizedpixel-wisepredictions.The
decompositionswerecomputedonthewholeimage.ImagestwicebyPixabayuserstpsdave,andbyPixabayuserssirocumoandPixeleye.
doi:10.1371/journal.pone.0130140.g007
whole.Pixel-wisepredictionsfortheclassesrepresentingbuses,persons,airplanesandcatsare
presentedinFigs7,8,9and10respectively.Aninterpretationwhichhasbeendrawnfromthe
depictedexamplesandotherexampleswhichareomittedhereisgiveninthefigurecaptions.
NeuralNetworksforMNISTdigits
Wewouldliketoinvestigatethecapacityofrelevancepropagationtofindevidenceforclassifi-
cationofMNISThandwrittendigits.Aparticularadvantageofthisdatasetovermany-class
imagedatasetsisthatitiseasyforhumanstointerpretbothpositiveandnegativeevidence,
becauseofthesmallnumberofclasses.Forexample,evidenceforthehandwrittendigit“1”
comesfromthepresenceofaverticalbaronthepixelgrid,butalsofromtheabsenceofhori-
zontalbarstartingfromthetopoftheverticalbar,whichwouldmakeita“7”.Also,thedataset
Fig8.Pixel-wisedecompositionforBagofWordsfeaturesoverahistogramintersectionkernelusingthelayer-wiserelevancepropagationforall
subsequentlayersandrank-mappingformappinglocalfeatures.Eachtripletofimagesshows—fromlefttoright—theoriginalimage,thepixel-wise
predictionssuperimposedwithprominentedgesfromtheinputimageandtheoriginalimagesuperimposedwithbinarizedpixel-wisepredictions.The
decompositionswerecomputedonthewholeimage.Facesbelowthehairlinebutalsohandsyieldhighscores,seethewomaninthethirdpicturewhich
turnsawayherfacefromthecameraasanexamplethathairaloneisnotrelevant.ImagesbyPelagioPalagi,WikimediausersRorschach,Frankie
FouganthinandFlickruserLeventdanslesdunes.
doi:10.1371/journal.pone.0130140.g008
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 25/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
Fig9.Pixel-wisedecompositionforBagofWordsfeaturesoverahistogramintersectionkernelusingthelayer-wiserelevancepropagationforall
subsequentlayersandrank-mappingformappinglocalfeatures.Eachtripletofimagesshows—fromlefttoright—theoriginalimage,thepixel-wise
predictionssuperimposedwithprominentedgesfromtheinputimageandtheoriginalimagesuperimposedwithbinarizedpixel-wisepredictions.The
decompositionswerecomputedonthewholeimage.Notablythetailofaplanereceivesnegativescoresconsistently.Blueskycontextseemstocontribute
toclassificationwhichhasbeenconjecturedalreadyinthePASCALVOCworkshops[35]andwhichwasobservedalsoonotherimagesnotshownhere,see
thethesecondpictureforcomparisonagainsttheotherthreeimageswhichhavemoreblueishsky.ImagesfromPixabayusersHolgi,nguyentuanhung,
rhodes8043andtpsdave.
doi:10.1371/journal.pone.0130140.g009
Fig10.Pixel-wisedecompositionforBagofWordsfeaturesoverahistogramintersectionkernelusingthelayer-wiserelevancepropagationfor
allsubsequentlayersandrank-mappingformappinglocalfeatures.Eachtripletofimagesshows—fromlefttoright—theoriginalimage,thepixel-wise
predictionssuperimposedwithprominentedgesfromtheinputimageandtheoriginalimagesuperimposedwithbinarizedpixel-wisepredictions.The
decompositionswerecomputedonthewholeimage.Positiveresponsesseemtoexistforcertainfurtexturepatterns,seealsothefalseresponsesonthe
woodandtheplasterinthesecondexamplewhichbothhavesimilartextureandcolortoacat’sfur.ImagesbyPixabayusersLoggaWigglerandHolcan.
doi:10.1371/journal.pone.0130140.g010
isrelativelysimpleandtherelationbetweenthetrainingalgorithmandtheresultingpixel-wise
relevancescanbeanalyzed.
WeperformthreeexperimentsforMNISTdata,aswewouldliketodemonstratethatthe
methodisabletouncoverpropertiesspecifictothewayoftraining.Oneexperimentisdone
withasmallernetworkwhichistrainedwithouttranslationsofdigitsforthesakeofallowinga
directcomparisonofthepixel-wisedecompositionresultstoclass-densitiesforeachpixelof
digitsandseeingtheimpactofartifactsinthetrainingset.Twofurtherexperimentsaredone
onalargernetworkwithhasbeentrainedwithoutartifactsandwithtranslatedversionsofdig-
itsandmoretrainingiterationsforthesakeofabetterresponsetodigits.Thelattertwoexperi-
mentsintendtoshowtheimpactofnon-digitpixelsaspositiveandnegativeevidencefora
classofdigits.
MNISTexperimentsI. Thefirstsetofexperimentsisdoneonafully-connectedneural
networktrainedinthemostcommonway:Inputdataisnormalizedsothatthesumofpixelsis
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 26/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
Fig11.Taylor-approximatedpixel-wisepredictionsforamultilayerneuralnetworktrainedandtestedontheMNISTdataset.Eachgroupoffour
horizontallyalignedpanelsshows—fromlefttoright—theinputdigit,theTaylorrootpointx ,thegradientofthepredictionfunctionfatx ofaspecificdigit
0 0
classindicatedbythesubscriptnexttofandtheapproximatedpixel-wisecontributionsforx.
doi:10.1371/journal.pone.0130140.g011
onaveragezero,andthevarianceofpixelvaluesisonaverageone.Thissettingimpliesthat
onlyblackpixelsyieldstronginputswhereaswhitepixelsfireonlyduetomeansubtraction.
Theabsenceoftranslationinvarianceduringtrainingallowstouncovercorrelationsofthe
pixel-wisedecompositiontopixel-wisetrainingdensitiesand,aswewillseeintheexperiments,
allowtouncoverartifactsinthedatathatmayharmgeneralization.
Examplesforpixel-wisedecompositionsforthefirsttypeofneuralnetworksaregivenin
Figs11,12and13.MultilayerneuralnetworksweretrainedontheMNIST[57]dataofhand-
writtendigitsandsolvetheposedten-classproblemwithapredictionaccuracyof98.25%on
theMNISTtestset.Ournetworkconsistsofthreelinearsum-poolinglayerswithabias-inputs,
followedbyanactivationornormalizationstepeach.Thefirstlinearlayeracceptsthe28×28
pixellargeimagesasa784dimensionalinputvectorandproducesa400-dimensionaltanh-
activatedoutputvector.Thesecondlayerprojectsthose400inputstoequallymanytanh-acti-
vatedoutputs.Thelastlayerthentransformsthe400-dimensionalspacetoa10-dimensional
outputspacefollowedbyasoftmaxlayerforactivationinordertoproduceoutputprobabilities
foreachclass.Thenetworkwastrainedusingastandarderrorback-propagationalgorithm
Fig12.Pixel-wisedecompositionsforamultilayerneuralnetworktrainedandtestedonMNISTdigits,usinglayer-wiserelevancepropagationas
inFormula(56).Eachgroupshowsthedecompositionofthepredictionfortheclassifierofaspecificdigitindicatedinparentheses.
doi:10.1371/journal.pone.0130140.g012
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 27/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
Fig13.Eachquadrupleshows:ontheleftmosttheinputdigit;onthemiddlelefttheclassspecificpixel-wisedensityratiosd (Eq(65))forthedigit
k
classkforwhichthepixel-wisedecompositioniscomputed;onthemiddlerightthepixel-wisedecompositionR(1)forthatdigitandthedigitclass
k;ontherightmostthecorrelationbetweend andthepixel-wisedecompositionR(1).Whenconsideringadigitfromclassiandapixel-wise
k
decompositionfromclassk6¼i,itisobservablethatthepixel-wisedecompositionshowsfrequentlyhighlypositiveactivationsonpixelsofthedigitfromclassi
whichhavehighrelativedensityd forthedigitclassk6¼i.
k
doi:10.1371/journal.pone.0130140.g013
usingbatchesof25randomlydrawntrainingsampleswithanaddedGaussiannoiselayerper
trainingiteration.Theabovepredictionaccuracywasachievedafterterminatingthetraining
procedureafter50000iterations.
Fig11showspixel-wiserelevancesresultingfromTaylor-typedecompositionasdefinedin
Eqs(18)and(53).Theleftcolumnofthefigureshowsapproximatedpixel-wiserelevancesof
theinputdigits,bothtimesa7,relativetoablankpixeltile.Relevancesarecalculatedforthe
classifieroutputproducingthepredictionscorefortheclassofdigits7.Evidentlytheupper
partofthedigitandmostprominentlythehorizontalbaratthetopareimportantcharacteris-
ticsforthepredictorspeakingforthedigit’sclass.ThemiddlecolumnofFig11showspixel-
wiserelevancesforinputsfromdigitclass5relativetoablanktileasinterpretedbytheclassi-
fieroutputreservedfortheclassofdigit3.Asfordigitclass7,thegradientattherootpointx
0
showshighpositivepredictionweightsinareascorrespondingtotypicalcharacteristicsofthe
targetclass.Weobservestrongpositiveresponsesinareassharedbybothdigitclasses5and3
(indicatedbyannotationa )andnegativepixel-wiseresponseswheretheupperleftverticalbar
2
oftheinputdigitsislocated,whichisusuallynotpresentinadigit3(a ).Therightmostcol-
1
umnofFig11indicatesdistinguishingpartsoftheinputdigitsfromclass2relativetotheir
counterpartsfromdigitclass6chosenbyminimaleuclideandistance.Highpixelscoreshigh-
lightcharacteristicsofthepredictionpointindicatingmembershipinclass2,mostnotablethe
upperarcandthetailoftheinputdigits2,asmarkedwiththeannotationa .Notablyinthe
2
lowerrightimageofthefiguretheabsenceoftheleftmostverticalarcofthedigit6(annotation
a )inthepredictionpointcausespositivelocalpredictionsforclass2.
1
Pixel-wisepredictionsobtainedviathelayer-wiserelevancepropagationFormula(56)were
calculatedbasedontheoutputofthelastlinearlayerwithouttakingthesucceedingsoftmax
normalizationlayerintoaccount.Wecanseepixel-wisedecompositionsforexemplarydigits
inFig12.Notably,forthepixel-wisedecompositionofthedigit2,weseehighlypositive
responsesinlowerpartsofthedigitsfortheclassifiersfordigits2and6,howeverfortheclassi-
fierfordigit6,thepredictionscoreisnegative,becausethehighpositiveresponsesinthelower
partaresuppressedbyhighnegativeresponsesintheupperpartwherethedigit2hasanarc
whichisnotpresentinthedigit6.
Correlatingthepixel-wisedecompositionsforclassifierfordigitkwiththerelativedensity
ofthepixelsofthedigitskinthetrainingsetdemonstratestheplausibilityofthe
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 28/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
decomposition.
P
NðpÞ
d ðpÞ¼P NP2digitsðkÞ ð65Þ
k 9 NðpÞ
l¼0 N2digitsðlÞ
ThiscanbeseeninFig13.Whenconsideringthedecompositionforaclassifierfordigitkand
usingadigiti6¼kfromthewrongclassasinput,thenweobserveoftenthatthedecomposition
showshighpositiveactivationsonthosepixelsofdigitiwhichhavehighrelativedensityd (p)
k
(Eq(65))withinthetrainingsetfordigitsoftypek.Evenwhenweusetheclassifierforthe
wrongclass,ituncoversevidenceonthosepixelswhichoverlapregionswithhighdensityof
positivelylabeleddigitsofitstrainingset.
MNISTexperimentsII. Inthissetofexperiments,wetrainlargerneuralnetworksonthe
MNISTdatasetaugmentedtranslatedcopiesofthedigits.Neuralnetworksarecomposedof
threehiddenlayersof1296unitseach,whereweightconnectionsbetweenlayersareinitialized
atrandom.Neuralnetworksaretrainedbybackpropagationusingstochasticgradientdescent
withminibatchesofsize25andusingasoftmaxobjective[6].Inordertoforcetheneuralnet-
worktomakedecisionsbasedontheshapeofdigitsratherthantheirabsolutepositiononthe
pixelgrid,weaugmentthetrainingdatawithpixel-wisetranslationsof±4pixels(bothvertical
andhorizontal)andadd10%salt-and-peppernoisetotheinputs.Also,inordertofavorthe
constructionofevidenceonbothblackandwhitepixels,MNISTdigitsarere-scaledtotake
pixelvaluesbetween−1(whitepixel)and1(blackpixel).
Weconsidertwotypesofnon-linearities:(1)rectifiedlinearunitsand(2)hyperbolictan-
gentsigmoids.Thesenon-linearitiesaresomeofthemostcommonlyusedinneuralnetworks
andareplottedinFig14.Also,inordertostudyexplanationsondifferentlevelofdetail,we
consider(1)anetworkthathasbeentrainedfor1000000iterationsuntilitreaches99.2%
accuracyand(2)anetworktrainedforonly10000iterations,atwhichpointitreachesapprox-
imately97.0%accuracy.
Figs15and16aretwocasestudiesofexplanationsproducedbytheneuralnetworkswe
havetrained.Thenumberinbracketsonthetop-leftcornerofthepixel-wisedecomposition
indicatestheclasswithrespecttowhichevidenceismeasured.Similarexplanationsarepro-
ducedbyanetworktrainedwithrectifiedlinearunits.Itisinterestingtonotethatlayer-wise
Fig14.Exampleofnon-linearactivationfunctionsgusedinmultilayerneuralnetworks.
doi:10.1371/journal.pone.0130140.g014
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 29/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
Fig15.Evidenceforahandwrittendigitbeinga“4”ora“9”.Strongpositiveevidencefor“4”isallocatedtothetoppartoftheimageforkeepingitblank.If
tryingtointerpretthesedigitsas“9”,theopentop-partoftheimageisperceivedasnegativeevidenceforthisclass,becausea“9”wouldratherhaveatop-
dashclosingtheupperloopofthe“4”.Explanationsareconsistentacrossavarietyofneuralnetworksandsamples.
doi:10.1371/journal.pone.0130140.g015
Fig16.Evidenceforahandwrittendigitbeinga“3”ora“8”.Classifyingas“3”issupportedbythemiddlehorizontalstrokefeaturedinthisdigitandthe
absenceofverticalconnectionsontheleftoftheimage.Evidenceforbeinga“8”featureagainthemiddlehorizontalstroke,however,theabsenceof
connectionsontheleftsideofthedigitconstitutesnegativeevidence.Explanationsareagainstableforvariousmodelsandsamples.
doi:10.1371/journal.pone.0130140.g016
relevancepropagation,whichisnotmakinguseofthegradientinformation—andtherefore
agnostictothetypeofneuronsinthenetwork,—stillproducessimilarresultsacrossdifferent
typesofneurons.Explanationslearnedbytherectifyingnetworkarearguablymoreglobal,
becausetherectifiedlinearunitsarepreventedfromsaturatingonbothsidesandtherefore
?
morelinear.Explanationsproducedbyarectifyingnetworktrainedforashortertime(rect )
areclearlymoreglobal,asevidencedbythepositiveandnegativepartsofthepixel-wisedecom-
positionsspreadingoverlargerpixelareas.
Inordertocomputethepixel-wisedecompositions,weusedEq(56),whichdoesnotuse
numericalstabilizers.Useofnumericalstabilizerscausesrelevancetoleakfromonelayerto
another,inparticular,whentherelevanceofaparticularhandwrittendigitismeasuredfor
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 30/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
anotherclass.Fig17showsexamplesofpixel-wisedecompositionsfor16randomlydrawndig-
itssortedaccordingtothedigitclass.
Pixelflippingexperimentsusingtherect-longmodelfromSectionMNISTexperimentsI
I. Inthissectionweintendtomakeasemi-quantitativeanalysisofthepixel-wisedecomposi-
tions.Thebasicideaistocomputeadecompositionofadigitforadigitclassandthenflippix-
elswithhighlypositive,highlynegativescoresorpixelswithscoresclosetozeroandthento
evaluatetheimpactoftheseflipsontothepredictionscores.Theadvantageofdemonstrating
thisonMNISTdataisthatavastmajorityofpixelseitherhasveryhigh(black)orverylow
(white)values,withveryfewpixelshavingvaluesinbetween.Forresultsonphotographic
scenesonemayneedtoresorttobuildingmaskswhicharespecifictoeachcategory,forexam-
ple,agrayboxmaybegoodformaskingaflower,butitwillnotmaskeffectivelyagrayroador
furofaKoalabear.
Ingeneral:Ifweflipapixel,wedoflipped=pixel(cid:3)(−1).Infurtherexperimentswewillcon-
siderthedigitsthreeandfourasinputs.Thetestsetcontains983foursand1011threes,over
whichthemeanpredictioniscalculated.
Oneapparentresultfromtheprecedingsectionisthatwecanobservenon-digitpixelswith
highlypositivepixelscores.InFig18weevaluatetheimpactofflippingnon-digitpixelswith
highlypositivepixelscoresontheresultingclassifierprediction.WeobserveinFig18thatthe
classifierpredictionforthetruedigitclass,namelythreeandfour,decreasesfastwhenthenon-
digitpixelswithhighpixelscoresareflipped.Thisshows,firstly,thathavingnon-digitpixels
withhighpositivepixelscoresmakessenseforacorrectclassification.Weseealso,thatflipping
thehighestscoringpixelsforadigitthreeturnsitintoadigiteight,whichisconsistenttothe
decompositionsseeninFig16.
Secondly,itshowsthatmeasuringthequalityofapixel-wisedecompositionbyanobject
segmentationmaskisnotalwaysagoodidea.Whenseeingthedigitasanobject,havingnon-
objectpixelswithhighscorescanmakesenseinthecaseofgeometricconstraintsforobjects
whicharetoberecognized,aswehaveinourcase.Forthisreasonwedeliberatelydidnot
chooseobjectsegmentationmasksforthedigitsasabasisforevaluationinthesensethatdigit-
pixelsshouldhavehighlypositivescores,andnon-digitpixelsshouldhavezeroornegative
scores.
Forthesamereason,namelythepossibilityofthepresenceofgeometricconstraints,pixel-
wisedecompositionisnotalwaysagoodweaksegmentationincontrasttotheconvincing
resultsintheexperimentsof[22]onimagesfromtheILSVRCdataset.Anotherreasonfora
possibledivergencebetweenpixel-wisedecompositionandsegmentationisthepossibleinflu-
enceofcontextinascene.
Oncewehaveestablishedthereasonwhywedonotusesegmentationmasksforevaluating
thequalityofpixel-wisepredictionwecanobservetheeffectsofflippingthehighestscoring
pixels,independentlyofwhethertheyareadigitornon-digitpixel.WecanseefromFig19
thatthepredictionofthecorrectdigitclassdecreasessharplyinthiscaseaswell.Thisdecrease
canbecomparedtothecasewhenweflipthosepixelswhoseabsolutevalueofthedecomposi-
tionscoresisclosesttozerobysortingthepixelsaccordingto1−jsj.WeseeinFig20thatthe
classifierpredictionforthetrueclassdecreasesonlyveryslowly,thusneutrallyscoredpixels
arelessrelevantfortheprediction.ThecomparisonbetweenFigs19and20showsthatthe
decompositionscoreisabletoidentifythosepixelswhichplaylittleroleintheclassificationof
adigitandthosepixelswhichareimportantforidentifyingadigit.
Thus,thepixel-wisedecompositionisnotonlyintuitivelyappealingtoahumanbutalso
makessensefortherepresentationusedinclassifiertomakeitsdecision.Usingdigitsfordem-
onstratingsuchastatementhasamildbiastowardsourmethodbecauseforageometric-driven
tasklikedigitswecanexpectthatfirstlytheproblemcanbelearnedwellbyaclassifiersothat
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 31/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
Fig17.Pixel-wisedecompositionsforallclassesfor16randomlydrawndigitsfromtheMNISTtestset.Resultsareobtainedusingtherelevance
propagationFormula(56)withtherectifyingnetworktrainedfor1000000iterationsfromSectionMNISTexperimentsII.
doi:10.1371/journal.pone.0130140.g017
| PLOSONE|DOI:10.1371/journal.pone.0130140 | July10,2015 | 32/46 |
| ---------------------------------------- | ----------- | ----- |

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
Fig18.Flippingofhigh-scoringnon-digitpixels.Pixelswithhighestpositivescoresareflippedfirst.Thepixel-wisedecompositionwascomputedforthe
truedigitclass,three(left)andfour(right).
doi:10.1371/journal.pone.0130140.g018
Fig19.Flippingofdigitandnon-digitpixelswithpositiveresponses.Pixelswithhighestpositivescoresareflippedfirst.Thepixel-wisedecomposition
wascomputedforthetruedigitclassesthree(left)andfour(right).
doi:10.1371/journal.pone.0130140.g019
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 33/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
Fig20.Flippingofpixelswithpixel-wisedecompositionscoreclosetozero.Pixelswithabsolutevalueclosesttozeroareflippedfirst.Digitandnon-
digitpixelsmaybeflipped.Pixel-wisedecompositionhavebeencomputedforthetruedigitclassesthree(left)andfour(right).
doi:10.1371/journal.pone.0130140.g020
theresultingpixel-wisedecompositionsareveryinformative,andsecondlywhathasbeen
learnedondigitsmightbemoresimilarbetweenhumansandalgorithmscomparedtocomplex
naturalscenerecognitiontasks.See,however,theexperimentsintheSectionNeuralNetwork
for1000ILSVRCclassesonthecategoriesfromILSVRCchallengeforresultsonanobjectrec-
ognitiontasksonphotographicimageswhichalsoyieldresultsplausibletoahuman.Ingeneral
onecanexpectthataclassifierwithpoorrecognitionabilitywillyieldalsopixel-wisedecompo-
sitionswithlessinformativescores.
Finally,weevaluatetheinfluenceofpixelswithnegativescores.Forthis,wetakeadigit,
computethepixel-wisedecompositionforawrongclass,thenflipthepixelswhicharemarked
negativelywhentryingtopredictthewrongclass.ResultsareshowninFig21.Weobservefor
bothexamplecasesthatthepredictionforthetrueclassdeclinessharplyaswetweakthedigits
towardsthewrongclass.Fordigit9astargetanddigits4asinputsthisflippingresultsina
noisyblobontopofastick,suchthattheresultisnotcleanlypredictableasanine.However
onecanobservestillamoderateriseofthepredictionofthe4asa9.Fordigit8astargetand
digits3asinputswecansee,thatforsomeintermediatepercentageofflips,the3willbeidenti-
fiedasan8.Insummary,negativelyscoredpixelsareabletorepresentwhatiscontradictoryto
classifyingadigittobelongtoaparticularclass.
TheresultsinFigs18,19and20areshownforthetrueclassagainstoneormoreparticular
wrongclasses.Theresultsholdalsowhenweshowthebehavioroftheclassifierpredictions
underflippingofthehighestscoringandthemostzero-likepixelswhenwecomparedforeach
digitagainstthemaximumofpredictionsoverallwrongclasses.Furthermorewecomputethe
averageoverall10digits,notonlydigits3and4astrueclassesasshowninFigs18,19and20.
ThisresultisshowninFig22.
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 34/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
Fig21.Flippingofpixelswithnegativeresponses,duetoapixel-wisedecompositionforpredictiontargets8(fordigits3ontheleft)and9(for
digits4ontheright).Pixelswithlowestnegativescoresareflippedfirst.
doi:10.1371/journal.pone.0130140.g021
Fig22.Flippingofpixelsfordigitandnon-digitpixels,comparedforeachmodifieddigitforthetrueclassagainstthemaximalpredictionofall
wrongclasses.Left:Pixelswithhighestpositivescoresareflippedfirst.Right:Flippingofneutrallypredictedpixels,i.e.pixelswithabsolutevalueclosestto
zeroareflippedfirst(solidlines),andflippingofrandomlypickedpixels(dashedlines).Resultsareaveragedoverdigitsfromalldigitclassesincontrastto
usingonlydigitclasses3and4intheprecedingfigures.
doi:10.1371/journal.pone.0130140.g022
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 35/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
Fig23.Examplesofimageswithanincreasingamountofflippedpixelsandthecorrespondingpredictionsoftheclassifier.Herepixelsareflipped
awayfromtheclasslabelgiveninparenthesesabovetheheatmap.Pixelswereflippedinstepsof1%ofallpixelsuntilthepredictedclasslabelchanged.The
plotsshowtheoutputofthesoftmaxfunctionyandtheoutputscoreoftheprecedinglinearlayeryp.Thepixelsweresortedbeforeflippingindecreasing
orderofthepixel-wisescore,i.e.highestscoringpixelswereflippedfirst.Inthispaneltheheatmapwascomputedfortheclassifierwhichproducedthe
highestscore,i.e.forthepredictedclasslabel.Theoriginallypredictedlabelisgivenontheleftmostimageinparentheses,thepredictedlabelaftertheswitch
ofthepredictionisgivenintherightmostimage.
doi:10.1371/journal.pone.0130140.g023
Onaverageoveralldigits,flippingthehighestscoringpixelsatfirstresultsinafastdecline
ofthepredictionforthetrueclass,andatsomepointanotherclassispredicted.Flippingthe
pixelsatfirstwithscoresclosetozeroresultsinamuchslowerdeclineofthepredictionforthe
trueclass.Thisresultdemonstratesaquantifiableplausibilityofthepixel-wisedecomposition
bylayer-wiserelevanceprediction.Inordertovisualizetheprocessofpixelflipping,Figs23
and24provideexamplesofadigit,itsheatmapandtheresultingimageswithincreasing
amountsofflippedpixels.Foreachoftheresultingimagesthesoftmaxoutputyandthelinear
layeroutputypareshown.ThefirstdifferencebetweenFigs23and24isthatintheformerthe
pixelswereflippedaccordingtotheheatmapforthehighestscoringclass,andinthelatterthe
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 36/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
pixelswereflippedaccordingtotheheatmapforarandomclasswhichdidnotyieldthehighest
score.TheseconddifferenceisthatinFig23thehighestscoringpixelswereflippedfirst,which
impliesthatevidenceforthepredictedclasslabelisremoved.Asaconsequence,theoriginal
predictionisgraduallylostwithoutgivingaspecificfalseclasslabelastarget.Thedigitin
Fig23changestowardsthatclasslabelwhichtheclassifierandtheheatmappingimplicitlyper-
ceiveasthenearestneighbor.Withrespecttotheseconddifference,inFig24thelowestscoring
pixelsfortherandomfalseclasslabelwereflippedfirst,whichimpliesthatevidenceagainstthe
falseclasslabelisremoved.Asaconsequence,thedigitismodifiedtowardsthespecificfalse
classlabelwhichisdenotedinparenthesesabovetheheatmap.InFig23eachofthedigits7
and8resultsintodifferentclasslabelsafterflipping.Wecanseethatdestroyingevidencefora
givenpredictedclassmayresultintodifferingfinalclasslabels.Thenearestneighborofadigit
isnotconstantwithinthedigitclass,butdependsonthestyleofthedigititself.Furthermore
wecanseethatpixel-flippingsometimesremovesandsometimesaddsblackpixels,depending
onwherethehighestpixelscoresarelocated.InFig24wecanseeresultsofflippingtowardsa
Fig24.Examplesofimageswithanincreasingamountofflippedpixelsandthecorrespondingpredictionsoftheclassifier.Herepixelsareflipped
towardstheclasslabelgiveninparenthesesabovetheheatmap.Pixelswereflippedinstepsof1%ofallpixelsuntilthepredictedclasslabelchanged.The
plotsshowtheoutputofthesoftmaxfunctionyandtheoutputscoreoftheprecedinglinearlayeryp.Thepixelsweresortedbeforeflippinginincreasingorder
ofthepixel-wisescore,i.e.lowestscoringpixelswereflippedfirst.Inthispaneltheheatmapwascomputedforaclassifierwhichdidnotproducethehighest
score,i.e.forarandomfalseclasslabel.Theoriginallypredictedlabelisgivenontheleftmostimageinparentheses,thepredictedlabelaftertheswitchofthe
predictionisgivenintherightmostimage.
doi:10.1371/journal.pone.0130140.g024
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 37/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
specifiedfalseclasslabel.Inbothcasestheresultingdigitsareplausibletothehumanobserver.
Notealsosmalldetails,e.g.the4inFig24isroundedatitslowerleftendduringflipping,while
theclassifierregardsthe7inFig24tobetooshortforbeinga1asseenonthebluespotabove
theverticalbarofthedigit.Finally,Fig17providesexamplesofthepixel-wisedecomposition
for16randomlydrawndigitsandthepredictorsforall10digitclasses.
NeuralNetworkfor1000ILSVRCclasses
Weuseherethepre-trainedneuralnetworkwhichisprovidedbytheCaffeopensourcepack-
age[60].Fig25showspixel-wisedecompositionsforexampleimagesfromcategoriesofthe
ILSVRCdataset.ResultsareshownonimagesfromWikimediaCommonsratherthanthe
ILSVRCimagesinordertoavoidlicenseproblemswhenshowingimages.Unsurprisinglythe
evidenceisnotassharpasfortheMNISTdatasetbecausetheunderlyingclassificationprob-
lemismuchmorediversewithahighercomplexityofclassesandimagestobeprocessed.We
canseefortheroosterhighscoresathiscockscombandpartsofhisfeathers.Theblackwidow
spiderhashighevidenceinherheadsectionwhichissurprisingbecauseitisnotsoprominent
tohumansbutisconsistentamongotherimagesofblackwidowspidersaswell.Furtherhigh
evidenceliesinpartsofblackwidowlegs,and,asexpected,thecharacteristicredspotsofa
blackwidow.Forthetabbycatweseeevidenceinhisfurbutalsointheroadsurfaceunderthe
catwhichhassimilarcolorandtexturetoacat’sfur.Theespressocuphashighresponseson
thecup’sedges,thegrip,someevidenceintheespressoliquid,howeveronlylittleresponsefor
theedgesontheaccompanyingsweetswhichhasthewrongcolor,gray,foranespresso.Note
thatagoodclassifierforaconceptdoesnotnecessarilyimplythatanobjectcanbelocalized
verywellbyitspixel-wisedecomposition.Sincetheclassifierprocessesanimageglobally,itcan
perceiveevidenceawayfromtheactualobject,forexamplebytakingintoaccounttypicalback-
groundofobjects,thecontextofanobjectorglobalstatisticswhicharecorrelatedtoanobject.
Inthatsense,forexample,bottlescanserveasevidenceforadiningtableorskycanbeaclue
forphotoswithairplanesonthegroundorphotosofoutsideviewsofchurches.
Fig26showsexampleswherethepixel-wisedecompositiondoesnotyielddiscriminative
results.Forthetoiletpaper,positivepredictionscoreswerealreadylowinbothexamples.This
correspondstoourexpectationthatalessdiscriminativeclassifierresultsalsoinlessconvinc-
ingpixel-wisedecompositions.
ComparingthedifferentshownmethodsinFigs25and27,onecanseethatthemethod
(58)withasmallvalueofthestabilizer(cid:3)producesresultswiththefinestgranularityandalso
withthehighestamountofnegativeevidence.Whenincreasingthevaluesofthestabilizer(cid:3),
themethodbecomeslessgranularandshowslessnegativeevidence.Thisresultwasalso
observedwhencomparingothersmallandlargevaluesofthestabilizer(cid:3).Thedecreaseofnega-
tivepixel-wisescoresandofgranularitycanbebothexplainedundersomeassumptions.
Firstly,notethatcomparedtoEq(58)withstabilizerequalto0theEq(58)withstabilizerεdif-
fersbyamultiplicativefactorof jzjj whichgoestozerowhenjzjgoestozero.Thusdampening
jzjjþ(cid:3) j
bythisfactorincreaseswhentheabsolutevalueofinputsjzjdecreases.Secondlynote,thatin
j
Eq(58)thesignoftherelevanceR
ofinputneuronjwillbeflippedinthemessagesRðl;lþ1Þfor
j i j
eitherthepositiveorthenegativeinputsz (dependingonthesignofzij).Whenweassumethat
ij zj
theneuronsatlayerl+1withsmallabsolutevalueofinputsjzjareresponsibleforgenerating
j
ahighproportionofallnegativemessagesRðl;lþ1Þ <0,thenthereductionofnegativepixel-wise
i j
scoresbyincreasingstabilizerεcanbeexplained.Suchanassumptioncanbereasonable
becauseasmallabsolutevalueofinputscansometimesbeexplainedbythesumofpositive
inputsbeingclosetothesumnegativeinputs,andnotingthateitherthepositiveorthenegative
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 38/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
Fig25.Thepixel-wisedecompositionsforexamplesimagesoftheneuralnetpre-trainedonILSVRCdatasetimagesandprovidedbytheCaffe
opensourcepackage[60].SecondcolumnshowsdecompositionscomputedbyFormula(58)withstabilizersε=0.01,thethirdcolumnwithstabilizersε=
100,thefourthcolumnwascomputedbyFormula(60)usingα=+2,β=−1.Theartifactsattheedgesoftheimagesarecausedbyfillingtheimagewith
locallyconstantvalueswhichcomesfromtherequirementtoinputsquaresub-partsofimagesintotheneuralnet.Picturesinorderofappearancefrom
WikimediaCommonsbyauthorsJensNietschmann,Shenrich91,Sandstein,JörgHempel.
doi:10.1371/journal.pone.0130140.g025
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 39/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
Fig26.Failureexamplesforthepixel-wisedecomposition.LeftandRight:Failurestorecognizetoiletpaper.ThedecompositionscomputedbyFormula
(58)withstabilizersε=0.01Theneuralnetisthepre-trainedoneonILSVRCdatafromtheCaffepackage[60].Thecomputingmethodsforeachcolumnare
thesameasinFig25.PicturesinorderofappearancefromWikimediaCommonsbyauthorsRobinhoodoftheBurgerWorldandTarotheShibaInu.
doi:10.1371/journal.pone.0130140.g026
setswillproducenegativemessagesRðl;lþ1Þ <0.Therefore,incaseofsmallinputs,sometimesa
i j
largefractionoftherelevanceR canbeturnedintonegativemessages.Ontheotherside,one
j
canexpectthatinaneuralnetworkwhichpredictsapositivescoref(x)>0,amajorityofnet-
workinputsispositive,andamajorityofneuronrelevancesR ispositive,sincetheirsum
j
withinalayerequalsf(x)>0.Inparticularonemayexpectfromthat,thatthemajorityofneu-
ronswithlargeinputsz havepositiverelevancesR >0,andthemessagesforneuronswith
j j
largeinputsz aremostlypositive.Inconclusion,positivescoresarelessaffectedbydampening
j
whenf(x)>0.Cancelingoutnegativescoresbyalargevalueof(cid:3)inintermediatelayersleads
alsotomorepositivescoresobservedinthefinalheatmaps,andthusalsotolessvisualgranu-
larity.Weemphasizethatthisisaqualitativeargumentwhichwevalidatedbycheckingasmall
numberimagesratherthanauniversallyholdingclaim.AsforpropertiesofEq(60),wenote
thatachoiceofβ<0suchthatα=1−βfixestheratioofnegativetopositivemessagesto (cid:5)b
1(cid:5)b
foreachneuron.Inparticular,thesumofthenegativemessagesisupperboundedbythesum
ofthepositivemessages.Forrectifiedlinearneuronsthisisareasonableassumptionbecause
theyfireonlywhentheirinputispositive.Inconclusion,ourchoiceβ=−1,yieldingaratioof
1:2towardspositivemessagesexplainswhytheheatmapsforthemethod(60)inFigs25and27
aredominantlypositive.
Itisknownfrom[21]thatlowerlayersofdeepnetworkswhichareverysimilartotheone
from[60]usedheremayactlikelearnedtextureorgradientdetectors.Fig27showsthatthe
pixel-wisedecompositionis,however,notequivalenttosimplyassigningscorestodominant
edges.TheoriginalimagesfromFig27havemanyregionswithstronggradients,howeverthe
pixel-wisedecompositionassignsnotablescoresonlytoasmallfractionofpixelswithlarge
gradients.Noteforexamplethatthehighlytexturedandvisuallyprominentwallpaperinthe
middleexamplewiththetablelampreceivesonlysmallscores.Thesameholdsfortheartifacts
attheedgesoftheimageswhichcomefromfillingtheimagewithlocallyconstantvalueswhich
isacompromiseinordertomaketheseimagestobeasquare.
Discussion
Nonlinearlearningmachinesareubiquitousinmodernproblemsolving.Whilehighlysuccess-
fuline.g.hardclassification,regressionorrankingproblems,theirnon-linearitysofarhaspre-
ventedthesemodelstoadditionallyexplainandthuscontributetoabetterunderstanding
aboutthenatureofthesolvedproblem.Making,say,anonlinearclassificationdecisionforone
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 40/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
Fig27.Thepixel-wisedecompositionisdifferentfromanedgeortexturedetector.Onlyasubsetofstrongedgesandtexturesreceivehighscores.
Panelsshowtheoriginalimageontheleft,andthedecompositionontheright.Thedecompositionswerecomputedtwicefortheclassestablelampandonce
fortheclassrooster.Theneuralnetisthepre-trainedoneonILSVRCdatafromtheCaffepackage[60].Thecomputingmethodsforeachcolumnarethe
sameasinFig25.Thelastrowshowsthegradientnormsnormalizedtoliein[0,1]mappedbythesamecolorschemeasfortheheatmaps.Picturesinorder
ofappearancefromWikimediaCommonsbyauthorsWtshymanski,SergeNinanneandImmanuelClio.
doi:10.1371/journal.pone.0130140.g027
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 41/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
particularnoveldatapointtransparenttotheuserisessentiallyorthogonaltothestandardtask
ofoptimizingforanexcellentandwellgeneralizingclassifier.Wehaveintroducedatoolsetfor
deconstructinganonlineardecisionandthusfosteringtransparencyfortheuser.
Inparticularwehaveintroducedthegeneralconceptofdecompositionofanonlinearimage
classificationdecisionintermsofpixels.Inotherwords,forawell-classifiedimage,aheatmap
canbeproducedthathighlightspixelsthatareresponsibleforthepredictedclassmembership.
Notethatthisispossiblewithoutneedofsegmentedtrainingimages.Weconsiderheatmap-
pingasanimportantpartoftheinterpretationofnonlinearlearningmachinesanditsapplica-
bilitygoesfarbeyondwhathasbeenexemplarilypresentedinthiswork:itrangesfromthe
interpretationofbio-medicalimagestothepracticalvalidationofatrainedmodelsforimage
classification.
Practically,wehaveproposedtwodifferentapproachestopixel-wisedecomposition:The
firstone,Taylor-typedecomposition,seekstolinearlyapproximatetheclassscoringfunction
locallybyperformingaTaylordecompositionofitnearaneutraldatapointwithoutclass
membership,wherethecontributionofeachdimension(i.e.pixel)caneasilybeidentified.The
secondone,coinedlayer-wiserelevancepropagation,appliesapropagationrulethatdistributes
classrelevancefoundatagivenlayerontothepreviouslayer.Thelayer-wisepropagationrule
wasappliediterativelyfromtheoutputbacktotheinput,thus,forminganotherpossiblepixel-
wisedecomposition.Thisinheritsthefavorablescalingpropertiesofbackpropagation.
Notably,thesetwomethodswerenotdefinedasaparticularsolutiontotheheatmapping
problem,butinsteadasasetofconstraintsthattheheatmappingproceduremustfulfillin
ordertobeadmissible.Forinstance,theexactchoiceofTaylorreferencepointwasnotspeci-
fiedbeyondtheconstraintsthatitshouldbearootandthatitshouldbelocatedclosetothe
actualdatapoint.Similarly,thelayer-wiserelevancepropagationhasbeendefinedwiththe
solerestrictionthatthepropagationruleconservesclassrelevanceonalayerandnodebasis.
Thus,thefurtherspecificationofrelevancepropagationruleisdeferredtotheappreciationof
theuser,orasafuturework,andmayeitherbemodel-specific,problem-specific,orsubjectto
aparticularpracticalorcomputationalrequirement.
Specificinstancesofthepixel-wisedecompositionproceduresatisfyingtheconstraintsmen-
tionedabovehavebeenproposedandanalyzed.Inparticular,ourworkhascoveredasetof
non-linearlearningalgorithmsforimageclassification,includingkernelclassifiersoverBagof
Wordspooledfeatures,andfeed-forwardmultilayerneuralnetworks.Bothmodelsarepopular
choicesforimageclassificationoranalysis.
OurexperimentsshowthatapplyingTaylor-typedecomposition,layer-wiserelevanceprop-
agationoracombinationofbothonthesenon-linearmodelsproduceshighlyinformedheat-
mapsthatreflectinmanyaspectsthesophisticationofthelearnedclassifier.Inparticular,we
havedemonstratedthatthesamerelevancepropagationrulemay,fordifferentimages,reactto
avarietyofimagefeatureswithintheboundsmodelingcapacity.Forexample,inthecaseof
theImageNetconvolutionalnetwork,wehaveshownthattheheatmappingprocedurefinds
class-relevantfeaturesthatcanbelargeareasofaparticularcolor,localizedfeatures,imagegra-
dients,ormorestructuredvisualfeaturessuchasedges,corners,contours,orobjectparts.
Animportantaspectoftheproposedheatmappingprocedureliesinthefactthatitdoesnot
requiretomodifythelearningalgorithm,ortolearnanadditionalmodelforheatmapping.
Instead,itcanbedirectlyandtransparentlyappliedtoany(pre-)trainedBagofWordsmodel
orneuralnetworkwhenapplicable.Thisdesirablepropertyisdemonstratedinthispaperby
theheatmappingofimagesclassifiedbythethird-partyGPU-trainedImageNetneuralnet-
work.Inparticular,ourheatmappingprocedurewasappliedtothisnetworkwithoutanyfur-
thertrainingorretraining.Thus,heatmapsfortheImageNetnetworkcouldbequickly
producedusingamodestCPU.
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 42/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
Whilewehaveproposedinthispaperseveralinstancesofpixel-wisedecompositionand
demonstratedtheirexcellentperformanceinpractice,thesetofpossiblerelevancepropagation
methods,andtheirmathematicalproperties,willcertainlyhavetobefurtherexplored.Afirst
aspectthatneedstobeinvestigatedisthegreedinessofthelayer-wiserelevancepropagation
procedure,inthesensethatitiscomputedonelayeratatime,anditspotentialimpactonthe
qualityofheatmaps:Whilecomputationallyadvantageous,someofthebackpropagatedrele-
vancemightencounteradead-endinthelowerlayersandbedistributedrandomly.Another
openquestionrelatestotheheuristicnatureoftheproposedinstancesofrelevancepropaga-
tion,inparticular,whetherthedistributedrelevancemessagesbeingproportionaltothe
weightedneuronactivationscanbeanalyticallyjustified.
Finally,itisnotclearhowtoevaluatethequalityofaheatmapbeyondsimplevisualassess-
ment.Inthispaperwehaveproposedasastartingpointapixel-flippingmethodthatallowsto
discriminatebetweentwoheatmappingmethodsthatmayotherwiselookofsimilarqualityto
thehuman.Findingquantitativepropertiesthataredesirablefortheseheatmaps,orfurther
constraintsontheheatmappingprocedureisthereforeofnaturetocomplementthehuman
assessment.Futureworkwillneedtoexplorethemanydomain-anddata-specificdegreesof
freedomintheheatmappingprocessinordertoultimatelyproposeauniversalmetricfor
quantification.Itisourfirmbelief,thatheatmappingwillbeanimportantingredientoffuture
knowledgediscoveryandexploratoryanalysisandunderstandingofcomplexdatainthesci-
encesandindustry,evenbeyondthepresentedfieldofimageanalysis.
Acknowledgments
ThisworkwassupportedinpartbytheFederalMinistryofEconomicsandTechnologyofGer-
many(BMWi)undertheprojectTHESEUS,grant01MQ07018,bytheGermanMinistryfor
EducationandResearchasBerlinBigDataCenterBBDC,fundingmark01IS14013Aandby
DFG.KRMthanksforpartialfundingbytheNationalResearchFoundationofKoreafunded
bytheMinistryofEducation,Science,andTechnologyintheBK21program.Correspondence
shouldbeaddressedtoSB,KRMandWS.
AuthorContributions
Conceivedanddesignedtheexperiments:SBABGMWSFKKRM.Performedtheexperi-
ments:SBABGM.Wrotethepaper:ABSBWSGMKRMFK.Conceivedthetheoretical
framework:ABGMSBWS.Performedtheexperiments:SBABGM.Revisedthemanuscript:
KRMWSGMABSB.Figuredesign:WSSBGMABFK.WrotecodeforMNIST:SBGM.
WrotecodeforILSVRC:AB.WrotecodeforBOW:SBAB.Imagesearchandgeneration:AB
SBGM.
References
1. Fei-FeiL.,Perona,P.ABayesianHierarchicalModelforLearningNaturalSceneCategories.In:2005
IEEEComputerSocietyConferenceonComputerVisionandPatternRecognition(CVPR2005),20-26
June2005,SanDiego,CA,USA.IEEEComputerSociety;2005.p.524–531.Availablefrom:http://dx.
doi.org/10.1109/CVPR.2005.16.
2. DahlkampH,KaehlerA,StavensD,ThrunS,BradskiGR.Self-supervisedMonocularRoadDetection
inDesertTerrain.In:Robotics:ScienceandSystems;2006.
3. WalkerR,JackwayP,LovellB,LongstaffD.ClassificationOfCervicalCellNucleiUsingMorphological
SegmentationAndTexturalFeatureExtraction.In:AustralianNewZealandConferenceonIntelligent
InformationSystems;1994.
4. HänschR,HellwichO.ObjectRecognitionfromPolarimetricSARImages.In:SoergelU,editor.Radar
RemoteSensingofUrbanAreas.vol.15ofRemoteSensingandDigitalImageProcessing. Springer
Netherlands;2010.p.109–131.Availablefrom:http://dx.doi.org/10.1007/978-90-481-3751-0_5.
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 43/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
5. ViolaPA,JonesMJ.RapidObjectDetectionusingaBoostedCascadeofSimpleFeatures.In:CVPR
(1);2001.p.511–518.
6. BishopCM.NeuralNetworksforPatternRecognition. NewYork,NY,USA: OxfordUniversityPress,
Inc.;1995.
7. CsurkaG,DanceCR,FanL,WillamowskiJ,BrayC.Visualcategorizationwithbagsofkeypoints.In:In
WorkshoponStatisticalLearninginComputerVision,ECCV;2004.p.1–22.Accessed2015Apr01.
Availablefrom:http://www.xrce.xerox.com/Research-Development/Publications/2004-0105/
(language)/eng-GB.
8. DengJ,BergA,SatheeshS,SuH,KhoslaA,Fei-FeiL.TheImageNetLargeScaleVisualRecognition
Challenge2012(ILSVRC2012);.Accessed2015Apr01.Availablefrom:http://www.image-net.org/
challenges/LSVRC/2012/.
9. EveringhamM,VanGoolL,WilliamsCKI,WinnJ,ZissermanA.ThePASCALVisualObjectClasses
Challenge2012(VOC2012)Results;.
10. MüllerH,CloughP,DeselaersT,CaputoB.ImageCLEF:ExperimentalEvaluationinVisualInformation
Retrieval.vol.32ofTheInformationRetrievalSeries. Springer;2010.
11. PerronninF,SánchezJ,MensinkT.ImprovingtheFisherKernelforLarge-ScaleImageClassification.
In:DaniilidisK,MaragosP,ParagiosN,editors.ECCV(4).vol.6314ofLectureNotesinComputerSci-
ence. Springer;2010.p.143–156.
12. YangJ,YuK,GongY,HuangTS.Linearspatialpyramidmatchingusingsparsecodingforimageclas-
sification.In:CVPR.IEEE;2009.p.1794–1801.
13. YuK,ZhangT,GongY.NonlinearLearningusingLocalCoordinateCoding.In:BengioY,Schuurmans
D,LaffertyJD,WilliamsCKI,CulottaA,editors.NIPS.CurranAssociates,Inc.;2009.p.2223–2231.
14. WangJ,YangJ,YuK,LvF,HuangTS,GongY.Locality-constrainedLinearCodingforimageclassifi-
cation.In:CVPR.IEEE;2010.p.3360–3367.
15. vanGemertJ,VeenmanCJ,SmeuldersAWM,GeusebroekJM.VisualWordAmbiguity.IEEETrans
PatternAnalMachIntell.2010;32(7):1271–1283.doi:10.1109/TPAMI.2009.132PMID:20489229
16. MontavonG,OrrGB,MüllerKR,editors.NeuralNetworks:TricksoftheTrade,Reloaded.vol.7700of
LectureNotesinComputerScience(LNCS). 2nded. Springer;2012.
17. BaehrensD,SchroeterT,HarmelingS,KawanabeM,HansenK,MüllerKR.HowtoExplainIndividual
ClassificationDecisions.JournalofMachineLearningResearch.2010;11:1803–1831.
18. RasmussenPM,SchmahT,MadsenKH,LundTE,YourganovG,StrotherSC,etal.Visualizationof
NonlinearClassificationModelsinNeuroimaging–SignedSensitivityMaps.In:HuffelSV,Correia
CMBA,FredALN,GamboaH,editors.BIOSIGNALS. SciTePress;2012.p.254–263.
19. HansenK,BaehrensD,SchroeterT,RuppM,MüllerKR.VisualInterpretationofKernel-BasedPredic-
tionModels.MolecularInformatics.2011;30(9):817–826.doi:10.1002/minf.201100059
20. ZeilerMD,FergusR.VisualizingandUnderstandingConvolutionalNetworks.CoRR.2013;doi:abs/
1311.2901.
21. KrizhevskyA,SutskeverI,HintonGE.ImageNetClassificationwithDeepConvolutionalNeuralNet-
works.In:BartlettPL,PereiraFCN,BurgesCJC,BottouL,WeinbergerKQ,editors.NIPS;2012.p.
1106–1114.
22. SimonyanK,VedaldiA,ZissermanA.DeepInsideConvolutionalNetworks:VisualisingImageClassifi-
cationModelsandSaliencyMaps.CoRR.2013;doi:abs/1312.6034.
23. ZeilerMD,TaylorGW,FergusR.Adaptivedeconvolutionalnetworksformidandhighlevelfeature
learning.In:ICCV;2011.p.2018–2025.
24. SzegedyC,ZarembaW,SutskeverI,BrunaJ,ErhanD,GoodfellowIJ,etal.Intriguingpropertiesof
neuralnetworks.CoRR.2013;doi:abs/1312.6199.
25. GoodfellowIJ,ShlensJ,SzegedyC.ExplainingandHarnessingAdversarialExamples.CoRR.2014;
abs/1412.6572.Availablefrom:http://arxiv.org/abs/1412.6572.
26. ChalupkaK,PeronaP,EberhardtF.VisualCausalFeatureLearning.CoRR.2014;abs/1412.2309.
Availablefrom:http://arxiv.org/abs/1412.2309.
27. ErhanD,BengioY,CourvilleA,VincentP.VisualizingHigher-LayerFeaturesofaDeepNetwork.Uni-
versityofMontreal;2009.1341.
28. LeQV.Buildinghigh-levelfeaturesusinglargescaleunsupervisedlearning.In:ICASSP;2013.p.
8595–8598.
29. GevreyM,DimopoulosI,LekS.Reviewandcomparisonofmethodstostudythecontributionofvari-
ablesinartificialneuralnetworkmodels.EcologicalModelling.2003;160(3):249–264.doi:10.1016/
S0304-3800(02)00257-0
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 44/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
30. OldenJD,JoyMK,DeathRG.Anaccuratecomparisonofmethodsforquantifyingvariableimportance
inartificialneuralnetworksusingsimulateddata.EcologicalModelling.2004;178(3-4):389–397.doi:
10.1016/j.ecolmodel.2004.03.013
31. SetionoR,LiuH.UnderstandingNeuralNetworksviaRuleExtraction.In:IJCAI.MorganKaufmann;
1995.p.480–487.
32. RasmussenPM,MadsenKH,LundTE,HansenLK.Visualizationofnonlinearkernelmodelsinneuro-
imagingbysensitivitymaps.NeuroImage.2011;55(3):1120–1131.doi:10.1016/j.neuroimage.2010.
12.035PMID:21168511
33. LiuL,WangL.Whathasmyclassifierlearned?Visualizingtheclassificationrulesofbag-of-feature
modelbysupportregiondetection.In:CVPR.IEEE;2012.p.3586–3593.
34. UijlingsJRR,SmeuldersAWM,SchaRJH.TheVisualExtentofanObject—SupposeWeKnowthe
ObjectLocations.InternationalJournalofComputerVision.2012;96(1):46–63.doi:10.1007/s11263-
011-0443-1
35. EveringhamM,VanGoolL,WilliamsCKI,WinnJ,ZissermanA.ThePASCALVisualObjectClasses
Challenge2009,Part2—ClassificationTask;.
36. EveringhamM,VanGoolL,WilliamsCKI,WinnJ,ZissermanA.ThePASCALVisualObjectClasses
Challenge2010(VOC2010)Results;.
37. NowakS,NagelK,LiebetrauJ.TheCLEF2011PhotoAnnotationandConcept-basedRetrievalTasks.
In:CLEF2011LabsandWorkshop,NotebookPapers,19-22September2011,Amsterdam,TheNeth-
erlands;2011.Accessed2015Apr01.Availablefrom:http://ceur-ws.org/Vol-1177/CLEF2011wn-
ImageCLEF-NowakEt2011.pdf.
38. MoosmannF,NowakE,JurieF.RandomizedClusteringForestsforImageClassification.IEEETrans
PatternAnalMachIntell.2008;30(9):1632–1646.doi:10.1109/TPAMI.2007.70822PMID:18617720
39. vanGemertJ,GeusebroekJM,VeenmanCJ,SmeuldersAWM.KernelCodebooksforSceneCategori-
zation.In:ECCV(3);2008.p.696–709.
40. LiuL,WangL,LiuX.Indefenseofsoft-assignmentcoding.In:MetaxasDN,QuanL,SanfeliuA,Gool
LJV,editors.ICCV.IEEE;2011.p.2486–2493.
41. BinderA,SamekW,MüllerKR,KawanabeM.Enhancedrepresentationandmulti-tasklearningfor
imageannotation.ComputerVisionandImageUnderstanding.2013;117(5):466–478.doi:10.1016/j.
cviu.2012.09.006
42. LoweDG.DistinctiveImageFeaturesfromScale-InvariantKeypoints.InternationalJournalofCom-
puterVision.2004;60(2):91–110.doi:10.1023/B:VISI.0000029664.99615.94
43. vandeSandeKEA,GeversT,SnoekCGM.EvaluatingColorDescriptorsforObjectandSceneRecog-
nition.IEEETransPatternAnalMachIntell.2010;32(9):1582–1596.doi:10.1109/TPAMI.2009.154
PMID:20634554
44. SánchezJ,PerronninF,MensinkT,VerbeekJJ.ImageClassificationwiththeFisherVector:Theory
andPractice.InternationalJournalofComputerVision.2013;105(3):222–245.doi:10.1007/s11263-
013-0636-x
45. LanckrietGRG,CristianiniN,BartlettPL,GhaouiLE,JordanMI.LearningtheKernelMatrixwithSemi-
definiteProgramming.JournalofMachineLearningResearch.2004;5:27–72.
46. BachFR,LanckrietGRG,JordanMI.Multiplekernellearning,conicduality,andtheSMOalgorithm.In:
ICML;2004.
47. KloftM,BrefeldU,SonnenburgS,LaskovP,MüllerKR,ZienA.EfficientandAccurateLp-normMultiple
KernelLearning.AdvancesinNeuralInformationProcessingSystems.2009;22(22):997–1005.
48. KloftM,BrefeldU,SonnenburgS,ZienA.l -NormMultipleKernelLearning.JournalofMachineLearn-
p
ingResearch.2011;12:953–997.
49. BinderA,NakajimaS,KloftM,MüllerC,SamekW,BrefeldU,etal.InsightsfromClassifyingVisual
ConceptswithMultipleKernelLearning.PLoSONE.2012;7(8).doi:10.1371/journal.pone.0038897
50. HwangSJ,GraumanK,ShaF.SemanticKernelForestsfromMultipleTaxonomies.In:NIPS;2012.p.
1727–1735.
51. BinderA,MüllerKR,KawanabeM.OnTaxonomiesforMulti-classImageCategorization.International
JournalofComputerVision.2012;99(3):281–301.doi:10.1007/s11263-010-0417-8
52. BlaschkoMB,ZarembaW,GrettonA.TaxonomicPredictionwithTree-StructuredCovariances.In:
ECML/PKDD(2);2013.p.304–319.
53. CaoL,LuoJ,LiangF,HuangTS.Heterogeneousfeaturemachinesforvisualrecognition.In:ICCV.
IEEE;2009.p.1095–1102.
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 45/46

Pixel-WiseExplanationsofNon-LinearWholeImageClassifierDecisions
54. ZhangJ,MarszalekM,LazebnikS,SchmidC.LocalFeaturesandKernelsforClassificationofTexture
andObjectCategories:AComprehensiveStudy.InternationalJournalofComputerVision.2007;73
(2):213–238.Availablefrom:http://dx.doi.org/10.1007/s11263-006-9794-4
55. VedaldiA,GulshanV,VarmaM,ZissermanA.Multiplekernelsforobjectdetection.In:ICCV;2009.p.
606–613.
56. RumelhartDE,HintonGE,WilliamsRJ.Learningrepresentationsbyback-propagatingerrors.Nature.
1986Oct;323:533–536.doi:10.1038/323533a0
57. LeCunY,CortesC.TheMNISTdatabaseofhandwrittendigits;1998.Accessed2015Apr01.Available
from:http://yann.lecun.com/exdb/mnist/.
58. PintoN,CoxDD,DiCarloJJ.WhyisReal-WorldVisualObjectRecognitionHard?PLoSComputBiol.
20081;4(1):27.doi:10.1371/journal.pcbi.0040027
59. LeCunY,KavukcuogluK,FarabetC.Convolutionalnetworksandapplicationsinvision.In:ISCAS.
IEEE;2010.p.253–256.
60. JiaY.Caffe:AnOpenSourceConvolutionalArchitectureforFastFeatureEmbedding;2013.Accessed
2015Apr01.Availablefrom:http://caffe.berkeleyvision.org/.
PLOSONE|DOI:10.1371/journal.pone.0130140 July10,2015 46/46