#include "quant_plugin_widget.hpp"
#include "quant_plugin_ui.hpp"
#include "market_history.hpp"
#include "market_feed.hpp"
#include <QNetworkReply>
#include <QtWidgets>
#include <cmath>

using namespace quantPlugin;
QuantPluginWidget::QuantPluginWidget(QString root,QWidget* parent,QString pluginId,bool historyOnly,MarketFeed* historyFeed)
    :QWidget(parent),repository_(root),job_(root,this),pluginId_(pluginId),historyOnly_(historyOnly) {
    if(pluginId_.isEmpty()&&!repository_.plugins().isEmpty())pluginId_=repository_.plugins().first().toObject().value("id").toString();
    historyFeed_=historyFeed;
    if(pluginId_=="org.webstock.akshare"&&!historyFeed_)historyFeed_=new MarketFeed(QFileInfo(root).absolutePath()+"/live",this,nullptr,false);
    setObjectName("quantPluginWidget");setProperty("pluginId",pluginId_);auto layout=new QVBoxLayout(this);layout->setSpacing(10);
    heading_=new QLabel;heading_->setStyleSheet("font-size:23px;font-weight:600;");layout->addWidget(heading_);
    auto split=new QSplitter;layout->addWidget(split,1);auto left=new QWidget;auto leftLayout=new QVBoxLayout(left);leftLayout->setContentsMargins(0,0,0,0);left->setMinimumWidth(420);left->setMaximumWidth(470);
    auto scroll=new QScrollArea;scroll->setWidgetResizable(true);leftLayout->addWidget(scroll,1);split->addWidget(left);
    controls_=new QWidget;form_=new QFormLayout(controls_);form_->setRowWrapPolicy(QFormLayout::WrapAllRows);form_->setVerticalSpacing(10);scroll->setWidget(controls_);
    filter_=new QLineEdit;filter_->setPlaceholderText("搜索本插件功能");form_->addRow("功能搜索",filter_);
    operations_=new QComboBox;operations_->setObjectName("pluginOperation");operations_->setSizeAdjustPolicy(QComboBox::AdjustToMinimumContentsLengthWithIcon);operations_->setMinimumContentsLength(18);form_->addRow("选择功能",operations_);
    description_=new QLabel;description_->setTextFormat(Qt::PlainText);description_->setWordWrap(true);form_->addRow(description_);
    historyOptions_=new QWidget;auto choices=new QFormLayout(historyOptions_);choices->setContentsMargins(0,0,0,0);
    sourceChoice_=new QComboBox;sourceChoice_->setObjectName("pluginDataSource");sourceChoice_->addItem("AKShare / 东方财富","akshare-eastmoney");sourceChoice_->addItem("腾讯公开K线 · 原程序","tencent-kline");choices->addRow("数据来源",sourceChoice_);
    auto identityRow=new QWidget;auto identityLayout=new QHBoxLayout(identityRow);identityLayout->setContentsMargins(0,0,0,0);marketChoice_=new QComboBox;marketChoice_->setObjectName("pluginMarket");for(auto pair:QList<QPair<QString,QString>>{{"深交所","SZ"},{"上交所","SH"},{"北交所","BJ"}})marketChoice_->addItem(pair.first,pair.second);
    securityType_=new QComboBox;securityType_->setObjectName("pluginSecurityType");securityType_->addItem("股票","stock");securityType_->addItem("指数","index");securityType_->addItem("ETF","etf");identityLayout->addWidget(marketChoice_);identityLayout->addWidget(securityType_);choices->addRow("市场 / 类型",identityRow);
    periodChoice_=new QComboBox;periodChoice_->setObjectName("pluginPeriod");periodChoice_->addItem("日线","day");periodChoice_->addItem("周线（腾讯）","week");periodChoice_->addItem("月线（腾讯）","month");choices->addRow("周期",periodChoice_);form_->addRow(historyOptions_);
    datasets_=new QComboBox;datasets_->setObjectName("pluginDataset");datasets_->setSizeAdjustPolicy(QComboBox::AdjustToMinimumContentsLengthWithIcon);datasets_->setMinimumContentsLength(18);form_->addRow("已保存行情",datasets_);
    dataSummary_=new QLabel;dataSummary_->setWordWrap(true);dataSummary_->setTextFormat(Qt::PlainText);dataSummary_->setObjectName("pluginDatasetSummary");form_->addRow(dataSummary_);
    auto inputRow=new QWidget;auto ih=new QHBoxLayout(inputRow);ih->setContentsMargins(0,0,0,0);input_=new QLineEdit;input_->setObjectName("pluginInput");input_->setPlaceholderText("也可选择自己的 CSV 文件");auto chooseInput=new QPushButton("浏览…");ih->addWidget(input_,1);ih->addWidget(chooseInput);form_->addRow("本地数据文件",inputRow);
    adjustment_=new QComboBox;for(auto code:{"unknown","unadjusted","forward","backward"})adjustment_->addItem(quantPluginUi::adjustment(code),code);form_->addRow("数据价格口径",adjustment_);
    closed_=new QCheckBox("确认输入仅包含已完成的K线");closed_->setObjectName("pluginClosedBars");form_->addRow(closed_);
    auto parameterPanel=new QWidget;parameters_=new QFormLayout(parameterPanel);parameters_->setContentsMargins(0,0,0,0);parameters_->setRowWrapPolicy(QFormLayout::WrapAllRows);parameters_->setVerticalSpacing(9);form_->addRow(parameterPanel);
    rangePresets_=new QWidget;auto range=new QHBoxLayout(rangePresets_);range->setContentsMargins(0,0,0,0);
    for(auto item:QList<QPair<QString,int>>{{"近一年",1},{"近三年",3},{"近五年",5}}){auto b=new QPushButton(item.first);b->setObjectName("pluginRange"+QString::number(item.second));range->addWidget(b);
        connect(b,&QPushButton::clicked,this,[this,years=item.second]{auto end=qobject_cast<QDateEdit*>(fields_.value("endDate"));auto start=qobject_cast<QDateEdit*>(fields_.value("startDate"));if(!end||!start)return;end->setDate(quantPluginUi::today().addDays(-1));start->setDate(end->date().addYears(-years));});}
    form_->addRow("常用时间范围",rangePresets_);
    adjustmentHelp_=new QLabel;adjustmentHelp_->setObjectName("pluginAdjustmentHelp");adjustmentHelp_->setWordWrap(true);form_->addRow(adjustmentHelp_);
    requestSummary_=new QLabel;requestSummary_->setObjectName("pluginRequestSummary");requestSummary_->setWordWrap(true);requestSummary_->setTextFormat(Qt::PlainText);requestSummary_->setStyleSheet("padding:10px;border:1px solid #6696be;border-radius:5px;");form_->addRow(requestSummary_);
    cacheState_=new QLabel;cacheState_->setObjectName("pluginCacheState");cacheState_->setWordWrap(true);cacheState_->setTextFormat(Qt::PlainText);form_->addRow(cacheState_);
    cacheActions_=new QWidget;auto ca=new QHBoxLayout(cacheActions_);ca->setContentsMargins(0,0,0,0);useCache_=new QPushButton("使用已保存数据（不联网）");useCache_->setObjectName("pluginUseCache");refreshMarket_=new QPushButton("主动刷新");refreshMarket_->setObjectName("pluginRefreshMarket");ca->addWidget(useCache_,1);ca->addWidget(refreshMarket_);leftLayout->addWidget(cacheActions_);
    auto actions=new QWidget;auto ab=new QHBoxLayout(actions);ab->setContentsMargins(0,0,0,0);run_=new QPushButton("运行所选功能");run_->setObjectName("pluginRun");run_->setMinimumHeight(40);cancel_=new QPushButton("取消");cancel_->setObjectName("pluginCancel");cancel_->setEnabled(false);ab->addWidget(run_,1);ab->addWidget(cancel_);leftLayout->addWidget(actions);
    progress_=new QProgressBar;progress_->setObjectName("pluginProgress");progress_->setRange(0,0);progress_->setTextVisible(false);progress_->hide();leftLayout->addWidget(progress_);
    environment_=new QLabel;environment_->setObjectName("pluginEnvironment");environment_->setWordWrap(true);form_->addRow(environment_);
    auto advancedButton=new QPushButton("高级设置 ▸");advancedButton->setObjectName("pluginAdvancedToggle");advancedButton->setCheckable(true);form_->addRow(advancedButton);
    advanced_=new QWidget;advanced_->setObjectName("pluginAdvanced");auto advancedForm=new QFormLayout(advanced_);advancedForm->setRowWrapPolicy(QFormLayout::WrapAllRows);advancedForm->setContentsMargins(0,0,0,0);
    runtime_=new QLineEdit;runtime_->setObjectName("pluginRuntime");auto runtimeRow=new QWidget;auto rh=new QHBoxLayout(runtimeRow);rh->setContentsMargins(0,0,0,0);rh->addWidget(runtime_,1);auto chooseRuntime=new QPushButton("浏览…");rh->addWidget(chooseRuntime);advancedForm->addRow("Python 解释器",runtimeRow);
    timeout_=new QSpinBox;timeout_->setRange(5,3600);timeout_->setValue(600);timeout_->setSuffix(" 秒");advancedForm->addRow("最长等待时间",timeout_);
    auto saveRuntime=new QPushButton("保存运行环境");advancedForm->addRow(saveRuntime);form_->addRow(advanced_);advanced_->hide();
    auto right=new QWidget;auto rl=new QVBoxLayout(right);rl->setContentsMargins(0,0,0,0);results_=new QTabWidget;results_->setObjectName("pluginResults");rl->addWidget(results_,1);
    auto empty=new QLabel("设置左侧条件后开始运行。\n也可在下方打开本插件的历史记录。");empty->setAlignment(Qt::AlignCenter);empty->setWordWrap(true);results_->addTab(empty,"预览");
    auto historyBar=new QHBoxLayout;historyBar->addWidget(new QLabel("本插件的历史记录"));historyBar->addStretch();auto exportResult=new QPushButton("导出结果包…"),importResult=new QPushButton("导入结果包…"),reloadHistory=new QPushButton("刷新历史");historyBar->addWidget(reloadHistory);historyBar->addWidget(exportResult);historyBar->addWidget(importResult);rl->addLayout(historyBar);
    history_=new QListWidget;history_->setObjectName("pluginHistory");history_->setWordWrap(true);history_->setMaximumHeight(145);history_->setMinimumHeight(90);rl->addWidget(history_);split->addWidget(right);split->setSizes({370,900});split->setStretchFactor(1,3);
    status_=new QLabel("进入窗口不会自动运行。历史档案可重开查看。");status_->setObjectName("pluginStatus");status_->setTextFormat(Qt::PlainText);status_->setWordWrap(true);layout->addWidget(status_);
    connect(chooseInput,&QPushButton::clicked,this,[this]{auto path=QFileDialog::getOpenFileName(this,"选择本地数据文件",{},"CSV (*.csv)");if(!path.isEmpty()){datasets_->setCurrentIndex(0);input_->setText(path);}});
    connect(input_,&QLineEdit::textEdited,this,[this]{datasets_->setCurrentIndex(0);});
    connect(advancedButton,&QPushButton::toggled,this,[this,advancedButton](bool open){advanced_->setVisible(open);advancedButton->setText(open?"高级设置 ▾":"高级设置 ▸");});
    connect(chooseRuntime,&QPushButton::clicked,this,[this]{auto path=QFileDialog::getOpenFileName(this,"选择此插件已配置的 Python 环境",{},"Python (python.exe);;所有文件 (*)");if(!path.isEmpty())runtime_->setText(path);});
    connect(saveRuntime,&QPushButton::clicked,this,[this]{guard([this]{auto p=repository_.plugin(pluginId_);repository_.configure(pluginId_,runtime_->text(),p.value("enabled").toBool());updateAvailability();status_->setText("运行环境已保存。");});});
    connect(filter_,&QLineEdit::textChanged,this,[this]{guard([this]{filterOperations();});});connect(operations_,&QComboBox::currentIndexChanged,this,[this]{guard([this]{selectOperation();});});
    connect(run_,&QPushButton::clicked,this,[this]{guard([this]{start();});});connect(cancel_,&QPushButton::clicked,this,[this]{sharedCancelled_=true;if(historyReply_)historyReply_->abort();job_.cancel();status_->setText("正在取消，已保存的公共行情保留…");});
    for(auto choice:{sourceChoice_,marketChoice_,securityType_,periodChoice_})connect(choice,&QComboBox::currentIndexChanged,this,[this]{updateRequestSummary();});
    connect(useCache_,&QPushButton::clicked,this,[this]{guard([this]{useSharedHistory();});});connect(refreshMarket_,&QPushButton::clicked,this,[this]{guard([this]{startSharedHistory(true);});});
    connect(datasets_,&QComboBox::currentIndexChanged,this,[this](int index){if(index>0)guard([this]{useSavedData(datasets_->currentData().toString());});else {dataSummary_->setText("选择已保存行情会核验原始档案，并保留股票、日期与来源。自选 CSV 需确认价格口径。" );input_->clear();closed_->setChecked(false);adjustment_->setCurrentIndex(0);if(operation_.value("inputKind")=="ohlcv-single-csv"){form_->setRowVisible(input_->parentWidget(),true);form_->setRowVisible(adjustment_,true);form_->setRowVisible(closed_,true);}}});
    connect(history_,&QListWidget::itemClicked,this,[this](QListWidgetItem* item){guard([this,item]{showResult(item->data(Qt::UserRole).toString());});});
    connect(reloadHistory,&QPushButton::clicked,this,[this]{guard([this]{refreshHistory();refreshDatasets();});});
    connect(exportResult,&QPushButton::clicked,this,[this]{guard([this]{auto item=history_->currentItem();require(item,"请先选择已完成的历史记录");auto bytes=job_.exportResult(item->data(Qt::UserRole).toString());auto path=QFileDialog::getSaveFileName(this,"导出含冻结数据的结果包",{},"WebStock 结果 (*.wsresult)");if(!path.isEmpty()){write(path,bytes);status_->setText("结果包已导出，含本次冻结的输入、代码及结果。");}});});
    connect(importResult,&QPushButton::clicked,this,[this]{guard([this]{auto path=QFileDialog::getOpenFileName(this,"导入结果包",{},"WebStock 结果 (*.wsresult)");if(path.isEmpty())return;auto id=job_.importResult(read(path,68*1024*1024));auto r=job_.reopen(id);refreshHistory();refreshDatasets();if(r.value("pluginId")==pluginId_)showResult(id);else status_->setText("结果包已导入。该记录属于其他插件，请从插件中心打开对应插件的历史档案。");});});
    job_.progress=[this](QString message){status_->setText(isMarketQuery()?"正在向 AKShare / 东方财富请求行情，等待数据源返回…":message);};
    job_.changed=[this]{guard([this]{refreshHistory();updateAvailability();auto r=job_.current();auto state=r.value("status").toString();
        if(sharedBusy_&&!job_.active()){
            if(state=="completed"&&!sharedCancelled_)try{auto result=job_.reopen(r["runId"].toString())["result"].toObject();auto q=batchQuery_;q["startDate"]=result["parameters"].toObject()["startDate"];q["endDate"]=result["parameters"].toObject()["endDate"];auto snapshot=marketHistory::fromAkshare(result,q);QPointer<QuantPluginWidget> self(this);historyFeed_->saveHistory(q,snapshot,sharedRefresh_||q["adjustment"]!="unadjusted",[self](QJsonObject saved,QString error){if(self)self->guard([&]{self->finishHistoryRange(saved,error);});});}
            catch(const std::exception& e){finishHistoryRange({},QString::fromUtf8(e.what()));}
            else {sharedBusy_=false;showResult(r["runId"].toString());updateRequestSummary();}return;
        }
        if(job_.active()){if(isMarketQuery())showResult(r.value("runId").toString());status_->setText(isMarketQuery()?"正在获取行情。请求已记录，可随时取消；等待数据源返回…":"插件正在独立进程中运行，可取消。");}
        else {if(state=="completed")refreshDatasets();showResult(r.value("runId").toString(),state=="completed");}});};
    guard([this]{if(pluginId_=="org.webstock.akshare")job_.reuseArchivedMarketData();selectPlugin();refreshHistory();});
    controls_->installEventFilter(this);
    left->setVisible(!historyOnly_);
}
QuantPluginWidget::~QuantPluginWidget(){sharedCancelled_=true;if(historyReply_)historyReply_->abort();job_.changed={};job_.progress={};job_.cancel();}
bool QuantPluginWidget::eventFilter(QObject* object,QEvent* event){
    if(object==controls_&&(event->type()==QEvent::Resize||event->type()==QEvent::LayoutRequest))QTimer::singleShot(0,this,[this]{
        for(auto label:controls_->findChildren<QLabel*>())if(label->wordWrap()&&label->width()>20){
            const auto height=label->heightForWidth(label->width());if(height>0&&label->minimumHeight()!=height)label->setMinimumHeight(height);
        }
    });
    return QWidget::eventFilter(object,event);
}
void QuantPluginWidget::guard(std::function<void()> action){try{action();}catch(const std::exception& e){status_->setText(QString::fromUtf8(e.what()));}}
void QuantPluginWidget::selectPlugin(){
    if(historyOnly_){heading_->setText(quantPluginUi::title(pluginId_,"插件")+" · 历史档案");return;}
    if(pluginId_.isEmpty()){heading_->setText("请先从插件中心安装并打开功能");controls_->setEnabled(false);return;}
    auto p=repository_.plugin(pluginId_);heading_->setText(quantPluginUi::title(pluginId_,p.value("name").toString()));runtime_->setText(repository_.runtimeFor(pluginId_));filterOperations();
}
void QuantPluginWidget::filterOperations(){
    QSignalBlocker block(operations_);auto previous=operation_.value("id").toString();operations_->clear();
    auto p=repository_.plugin(pluginId_);for(auto v:p.value("manifest").toObject().value("operations").toArray()){auto op=v.toObject();if(op.value("title").toString().contains(filter_->text(),Qt::CaseInsensitive))operations_->addItem(op.value("title").toString(),op);}
    for(int i=0;i<operations_->count();++i)if(operations_->itemData(i).toJsonObject().value("id")==previous)operations_->setCurrentIndex(i);selectOperation();
}
bool QuantPluginWidget::isMarketQuery() const{return pluginId_=="org.webstock.akshare"&&operation_.value("id")=="daily-eastmoney";}
void QuantPluginWidget::selectOperation(){
    fields_.clear();while(parameters_->rowCount())parameters_->removeRow(0);operation_=operations_->currentData().toJsonObject();
    const auto kind=operation_.value("inputKind").toString();const bool query=kind=="parameters-only",market=isMarketQuery();
    form_->setRowVisible(filter_,!market);form_->setRowVisible(operations_,!market);description_->setText(market?"① 选证券与来源 → ② 选范围与口径\n自动检查原程序公共行情库，再使用已有数据、补齐缺失或主动刷新。":operation_.value("description").toString());
    form_->setRowVisible(input_->parentWidget(),!query);form_->setRowVisible(adjustment_,kind=="ohlcv-single-csv");form_->setRowVisible(closed_,!query);
    form_->setRowVisible(datasets_,kind=="ohlcv-single-csv");form_->setRowVisible(dataSummary_,kind=="ohlcv-single-csv");
    form_->setRowVisible(rangePresets_,market);form_->setRowVisible(adjustmentHelp_,market);form_->setRowVisible(requestSummary_,market);
    form_->setRowVisible(historyOptions_,market);form_->setRowVisible(cacheState_,market);cacheActions_->setVisible(market);
    closed_->setChecked(false);closed_->setText(kind=="option-chain-csv"?"确认期权报价及模型输入当时可知":kind=="research-observations-csv"?"确认数据发布及修订当时可知":kind=="portfolio-equity-csv"?"确认权益、费用与出入金当时可知":kind=="market-events-csv"?"确认输入事件已发生且当时可知":"确认输入仅包含已完成的K线");
    if(auto label=qobject_cast<QLabel*>(form_->labelForField(input_->parentWidget())))label->setText(kind=="option-chain-csv"?"期权链报价 CSV":kind=="research-observations-csv"?"研究数据发布 / 修订 CSV":kind=="portfolio-equity-csv"?"策略权益 / 出入金 CSV":kind=="market-events-csv"?"逐笔成交 / 盘口 CSV":kind=="market-panel-csv"?"历史多证券 CSV":"本地历史K线 CSV");
    QJsonObject saved;if(!operation_.isEmpty()){auto p=repository_.plugin(pluginId_);auto raw=p.value("parametersByOperation").toObject().value(operation_.value("id").toString()).toObject();if(!raw.isEmpty())try{saved=validateParameters(operation_,raw);}catch(const std::exception&){} }
    for(auto v:operation_.value("parameters").toArray()){auto f=v.toObject();auto key=f.value("id").toString();QWidget* field;
        if(saved.contains(key))f["default"]=saved.value(key);
        if(f.value("type")=="choice"){auto box=new QComboBox;for(auto x:f.value("choices").toArray())box->addItem(market&&key=="adjustment"?quantPluginUi::adjustment(x.toString()):x.toVariant().toString(),x.toVariant());box->setCurrentIndex(box->findData(f.value("default").toVariant()));field=box;connect(box,&QComboBox::currentIndexChanged,this,[this]{updateRequestSummary();});}
        else if(f.value("type")=="text"&&f.value("format")=="date"){
            auto date=new QDateEdit;date->setCalendarPopup(true);date->setLocale(QLocale(QLocale::Chinese,QLocale::China));date->setDisplayFormat("yyyy-MM-dd");date->setMinimumDate(QDate(1990,1,1));date->setMaximumDate(market?quantPluginUi::today().addDays(-1):QDate(9999,12,31));
            auto initial=QDate::fromString(f.value("default").toString(),Qt::ISODate);if(market&&saved.isEmpty())initial=key=="endDate"?quantPluginUi::today().addDays(-1):quantPluginUi::today().addDays(-1).addYears(-1);date->setDate(initial);field=date;connect(date,&QDateEdit::dateChanged,this,[this]{updateRequestSummary();});
        }else if(f.value("type")=="text"){
            auto edit=new QLineEdit(f.value("default").toString());edit->setMaxLength(f.value("maxLength").toInt());if(f.value("format")=="cn-stock"){edit->setPlaceholderText("六位 A 股代码，例如 000001");edit->setValidator(new QRegularExpressionValidator(QRegularExpression("[0-9]{0,6}"),edit));}field=edit;connect(edit,&QLineEdit::textChanged,this,[this]{updateRequestSummary();});
        }else {auto spin=new QDoubleSpinBox;bool integer=f.value("type")=="integer";int decimals=integer?0:6;
            if(!integer)for(auto k:{"default","minimum"}){double value=std::abs(f.value(k).toDouble());if(value>0&&value<1)decimals=std::max(decimals,std::min(12,int(std::ceil(-std::log10(value)))+2));}
            spin->setDecimals(decimals);spin->setRange(f.value("minimum").toDouble(),f.value("maximum").toDouble());spin->setValue(f.value("default").toDouble());spin->setSingleStep(integer?1:.01);if(!integer)spin->setStepType(QAbstractSpinBox::AdaptiveDecimalStepType);field=spin;}
        field->setObjectName("pluginParam_"+key);fields_[key]=field;parameters_->addRow(f.value("title").toString(),field);
        if(market&&key=="symbol"){auto hint=new QLabel("仅接受六位代码，如 000001。当前不提供全市场名称搜索；不推断股票名称。");hint->setWordWrap(true);parameters_->addRow(hint);}
    }
    run_->setText(market?"获取行情":operation_.value("outputKind")=="backtest"?"运行历史回测":operation_.value("outputKind")=="data"?"处理数据":"计算指标 / 模型");
    refreshDatasets();
    if(kind=="ohlcv-single-csv"&&!datasets_->currentData().toString().isEmpty())useSavedData(datasets_->currentData().toString());
    else if(kind!="ohlcv-single-csv"&&!datasets_->currentData().toString().isEmpty()){QSignalBlocker block(datasets_);datasets_->setCurrentIndex(0);input_->clear();}
    updateRequestSummary();updateAvailability();
}
QJsonObject QuantPluginWidget::parameters() const {
    QJsonObject result;for(auto i=fields_.begin();i!=fields_.end();++i){if(auto s=qobject_cast<QDoubleSpinBox*>(i.value()))result[i.key()]=s->value();else if(auto date=qobject_cast<QDateEdit*>(i.value()))result[i.key()]=date->date().toString(Qt::ISODate);else if(auto edit=qobject_cast<QLineEdit*>(i.value()))result[i.key()]=edit->text();else result[i.key()]=QJsonValue::fromVariant(qobject_cast<QComboBox*>(i.value())->currentData());}return result;
}
void QuantPluginWidget::updateRequestSummary(){
    if(!isMarketQuery()||!fields_.contains("adjustment"))return;auto p=parameters();historyPlan_={};
    try{
        auto q=sharedQuery();historyPlan_=historyFeed_->inspectHistory(q);auto summary=historyPlan_["summary"].toObject();QStringList ranges;
        for(auto v:historyPlan_["missingRanges"].toArray()){auto r=v.toObject();ranges<<r["start"].toString()+" 至 "+r["end"].toString();}
        QString cache=historyPlan_["compatible"].toBool()?QString("公共行情库已保存：%1\n采集：%2\n%3").arg(quantPluginUi::dataLabel(summary),quantPluginUi::time(summary["acquiredAtUtc"].toString()),historyPlan_["complete"].toBool()?"所选范围覆盖已核验，可直接使用，不需联网。":historyPlan_["coverageNote"].toString()):"公共行情库尚无兼容的已核验数据。";
        if(historyPlan_["compatible"].toBool()&&historyPlan_["availableRows"].toInt()==0){
            auto rows=historyPlan_["snapshot"].toObject()["rows"].toArray();
            cache=QString("同口径缓存实际保存：%1 至 %2\n所选日期范围没有已保存的完整K线。\n采集：%3").arg(rows.first().toObject()["label"].toString(),rows.last().toObject()["label"].toString(),quantPluginUi::time(summary["acquiredAtUtc"].toString()));
        }
        if(historyPlan_["staleAdjusted"].toBool())cache+="\n复权快照已跨日：可明确使用旧版本；更新时须刷新整个所选范围，不能只追加新日期。";
        if(historyPlan_["sourceTruncated"].toBool())cache+="\n来源达到返回上限，存在截断；实际区间已单独标出。";
        if(!historyPlan_["legacyWarning"].toString().isEmpty())cache+="\n"+historyPlan_["legacyWarning"].toString();
        cacheState_->setText(cache);
        requestSummary_->setText(QString("证券：%1 · %2 · %3\n来源：%4\n补齐缺失：%5\n主动刷新：将联网重新请求 %6 至 %7。%8")
            .arg(quantPluginUi::security(q["securityId"].toString()),periodChoice_->currentText(),quantPluginUi::adjustment(q["adjustment"].toString()),sourceChoice_->currentText(),ranges.isEmpty()?"无未请求区间；可使用保存数据或主动刷新":QString("将联网请求 ")+ranges.join("；"),q["startDate"].toString(),q["endDate"].toString(),historyPlan_["adjustedRefreshRequired"].toBool()?"复权口径需刷新整个选定范围，不与旧基准拼接。":""));
    }catch(const std::exception& e){requestSummary_->setText(QString::fromUtf8(e.what()));cacheState_->setText("请先选择有效的证券身份、日期和数据口径。");}
    adjustmentHelp_->setText(quantPluginUi::adjustmentHelp(p["adjustment"].toString()));updateAvailability();
}
void QuantPluginWidget::updateAvailability(){
    bool enabled=false,ready=false;try{auto p=repository_.plugin(pluginId_);enabled=p.value("enabled").toBool();ready=QFileInfo(runtime_->text()).isAbsolute()&&QFileInfo(runtime_->text()).isFile();}catch(const std::exception&){}
    bool valid=!operation_.isEmpty();if(isMarketQuery()){valid=!historyPlan_.isEmpty();if(sourceChoice_->currentData()=="tencent-kline")ready=true;run_->setText("补齐缺失行情");}
    const bool busy=isRunning();run_->setEnabled(!historyOnly_&&enabled&&ready&&valid&&!busy&&(!isMarketQuery()||!historyPlan_["missingRanges"].toArray().isEmpty()));cancel_->setEnabled(busy);progress_->setVisible(busy);
    useCache_->setEnabled(!busy&&historyPlan_["compatible"].toBool()&&historyPlan_["availableRows"].toInt()>0);refreshMarket_->setEnabled(!busy&&enabled&&ready&&valid);historyOptions_->setEnabled(!busy);
    environment_->setText(!enabled?"插件已停用或卸载，请在插件中心启用或安装。":ready?"运行环境已就绪":"未找到本机已配置的运行环境。展开高级设置选择此插件的 Python；不会自动安装依赖。");
    filter_->setEnabled(!busy);operations_->setEnabled(!busy);
    for(auto field:fields_)field->setEnabled(!busy);rangePresets_->setEnabled(!busy);
    input_->setEnabled(!busy);datasets_->setEnabled(!busy);advanced_->setEnabled(!busy);
}
QJsonObject QuantPluginWidget::sharedQuery() const {
    auto p=parameters();return marketHistory::query({{"securityId",marketChoice_->currentData().toString()+":"+securityType_->currentData().toString()+":"+p["symbol"].toString()},
        {"period",periodChoice_->currentData().toString()},{"sourceId",sourceChoice_->currentData().toString()},{"adjustment",p["adjustment"]},{"startDate",p["startDate"]},{"endDate",p["endDate"]}});
}
void QuantPluginWidget::startSharedHistory(bool refresh){
    require(!isRunning(),"已有行情请求运行");auto installed=repository_.plugin(pluginId_);require(installed["enabled"].toBool(),"数据源插件已停用");
    batchQuery_=sharedQuery();historyPlan_=historyFeed_->inspectHistory(batchQuery_);sharedRefresh_=refresh;sharedCancelled_=false;
    remainingRanges_=refresh?QJsonArray{QJsonObject{{"start",batchQuery_["startDate"]},{"end",batchQuery_["endDate"]}}}:historyPlan_["missingRanges"].toArray();
    if(remainingRanges_.isEmpty()){status_->setText("没有未请求的区间。请选择使用已保存数据；这不代表已经取得最新行情。");return;}
    if(batchQuery_["sourceId"]=="akshare-eastmoney")repository_.configure(pluginId_,runtime_->text(),true);
    sharedBusy_=true;updateAvailability();try{nextHistoryRange();}catch(const std::exception& e){finishHistoryRange({},QString::fromUtf8(e.what()));}
}
void QuantPluginWidget::nextHistoryRange(){
    if(sharedCancelled_){finishHistoryRange({},"已取消；已成功保存的片段保留");return;}
    if(remainingRanges_.isEmpty()){sharedBusy_=false;updateRequestSummary();refreshDatasets();useSharedHistory(true);return;}
    auto range=remainingRanges_.takeAt(0).toObject();auto q=batchQuery_;q["startDate"]=range["start"];q["endDate"]=range["end"];
    while(results_->count()){auto w=results_->widget(0);results_->removeTab(0);w->deleteLater();}
    auto pending=new QLabel("正在请求 "+q["startDate"].toString()+" 至 "+q["endDate"].toString()+"\n来源："+sourceChoice_->currentText()+"\n旧数据仍保留；本次完成并保存后才会显示为更新成功。");pending->setWordWrap(true);pending->setAlignment(Qt::AlignCenter);results_->addTab(pending,"正在补齐 / 刷新");
    if(q["sourceId"]=="akshare-eastmoney")job_.start(pluginId_,"daily-eastmoney",{},{{"symbol",q["securityId"].toString().section(':',2)},{"startDate",q["startDate"]},{"endDate",q["endDate"]},{"adjustment",q["adjustment"]}}, {},timeout_->value());
    else {QPointer<QuantPluginWidget> self(this);historyReply_=historyFeed_->fetchHistory(q,sharedRefresh_,[self](QJsonObject saved,QString error){if(self)self->guard([&]{self->finishHistoryRange(saved,error);});});}
}
void QuantPluginWidget::finishHistoryRange(const QJsonObject&,const QString& error){
    historyReply_=nullptr;
    if(sharedCancelled_||!error.isEmpty()){
        sharedBusy_=false;remainingRanges_={};updateRequestSummary();refreshDatasets();
        while(results_->count()){auto w=results_->widget(0);results_->removeTab(0);w->deleteLater();}
        auto failure=new QLabel((sharedCancelled_?QString("本次更新已取消。"):QString("本次更新失败：")+error)+"\n公共缓存保留。可明确点击“使用已保存数据”，不会把旧缓存当作新请求成功。");failure->setObjectName("pluginFailureReason");failure->setWordWrap(true);failure->setAlignment(Qt::AlignCenter);results_->addTab(failure,"更新结果");status_->setText(failure->text());return;
    }
    try{nextHistoryRange();}catch(const std::exception& e){sharedBusy_=false;updateAvailability();status_->setText(QString::fromUtf8(e.what()));}
}
void QuantPluginWidget::useSharedHistory(bool fresh){
    require(!isRunning(),"请等待当前请求结束后选择缓存");auto q=sharedQuery();auto plan=historyFeed_->inspectHistory(q);require(plan["compatible"].toBool()&&plan["availableRows"].toInt()>0,"所选范围没有可核验的公共行情");
    showResult(marketHistory::token(plan["snapshot"].toObject(),q),fresh);if(!fresh)cacheState_->setText(cacheState_->text()+"\n本次查看只使用已保存版本；没有触发联网。");
}
void QuantPluginWidget::refreshDatasets(){
    QSignalBlocker block(datasets_);auto current=datasets_->currentData();datasets_->clear();datasets_->addItem("选择已保存行情，或浏览本地 CSV",QString());
    for(auto v:job_.savedMarketData()){auto d=v.toObject();datasets_->addItem(quantPluginUi::dataLabel(d)+" · 采集 "+quantPluginUi::time(d.value("acquiredAtUtc").toString()),d.value("runId").toString());datasets_->setItemData(datasets_->count()-1,datasets_->itemText(datasets_->count()-1),Qt::ToolTipRole);}
    int i=datasets_->findData(current);datasets_->setCurrentIndex(std::max(0,i));
}
void QuantPluginWidget::useSavedData(const QString& id){
    require(!job_.active(),"当前任务正在运行，请等待完成后切换输入");
    if(operation_.value("inputKind")!="ohlcv-single-csv"){
        int found=-1;for(int i=0;i<operations_->count();++i)if(operations_->itemData(i).toJsonObject().value("inputKind")=="ohlcv-single-csv"){found=i;break;}
        require(found>=0,"此插件当前没有接受单证券日线的功能");operations_->setCurrentIndex(found);
    }
    auto input=job_.marketDataInput(id),summary=input.value("summary").toObject();refreshDatasets();{QSignalBlocker block(datasets_);if(datasets_->findData(id)<0)datasets_->addItem(quantPluginUi::dataLabel(summary)+" · 所选冻结档案",id);datasets_->setCurrentIndex(datasets_->findData(id));}
    input_->setText(input.value("path").toString());adjustment_->setCurrentIndex(adjustment_->findData(summary.value("adjustment").toString()));closed_->setChecked(true);
    form_->setRowVisible(input_->parentWidget(),false);form_->setRowVisible(adjustment_,false);form_->setRowVisible(closed_,false);
    dataSummary_->setText("已校验的保存行情：\n"+quantPluginUi::dataLabel(summary)+"\n采集："+quantPluginUi::time(summary.value("acquiredAtUtc").toString())+"\n采集时快照，不代表历史当时可见的数据。运行时将冻结此档案作为输入。");
    status_->setText("已填入保存行情。选择指标或回测参数后运行。");
}
void QuantPluginWidget::refreshHistory(){
    auto current=history_->currentItem()?history_->currentItem()->data(Qt::UserRole).toString():QString();history_->clear();
    for(auto v:job_.records()){auto r=v.toObject();if(r.value("pluginId")!=pluginId_)continue;auto p=r.value("parameters").toObject();auto state=r.value("status").toString();
        auto stateText=state=="completed"?QString("成功 · 已保存"):state=="failed"?QString("失败"):state=="cancelled"?QString("已取消"):state=="timed_out"?QString("超时"):state=="running"||state=="starting"?QString("运行中"):state;
        auto label=stateText+" · "+quantPluginUi::time(r.value("createdAt").toString());
        if(pluginId_=="org.webstock.akshare")label+="\n"+p.value("symbol").toString()+" · 请求 "+p.value("startDate").toString()+" 至 "+p.value("endDate").toString()+" · "+quantPluginUi::adjustment(p.value("adjustment").toString());else label+=" · "+r.value("operationTitle").toString(r.value("operationId").toString());
        auto summary=r.value("dataSummary").toObject();if(!summary.isEmpty())label+=" · 实际 "+summary.value("firstDate").toString()+" 至 "+summary.value("lastDate").toString()+QString(" / %1 交易日").arg(summary.value("bars").toInt());
        auto item=new QListWidgetItem(label,history_);item->setData(Qt::UserRole,r.value("runId").toString());if(r.value("runId")==current)history_->setCurrentItem(item);
    }
}
void QuantPluginWidget::restoreQuery(const QJsonObject& p){
    require(!job_.active(),"请先等待当前请求结束");for(auto i=fields_.begin();i!=fields_.end();++i){if(!p.contains(i.key()))continue;if(auto date=qobject_cast<QDateEdit*>(i.value()))date->setDate(QDate::fromString(p.value(i.key()).toString(),Qt::ISODate));else if(auto edit=qobject_cast<QLineEdit*>(i.value()))edit->setText(p.value(i.key()).toString());else if(auto choice=qobject_cast<QComboBox*>(i.value()))choice->setCurrentIndex(choice->findData(p.value(i.key()).toVariant()));}updateRequestSummary();
}
void QuantPluginWidget::start(){
    require(!historyOnly_&&!operation_.isEmpty(),"请从插件中心打开已安装的功能");auto installed=repository_.plugin(pluginId_);require(installed.value("enabled").toBool(),"插件已停用");
    if(isMarketQuery()){startSharedHistory(false);return;}
    auto args=validateParameters(operation_,parameters());if(isMarketQuery()){require(QDate::fromString(args.value("startDate").toString(),Qt::ISODate)<=QDate::fromString(args.value("endDate").toString(),Qt::ISODate),"开始日期不能晚于结束日期");require(QDate::fromString(args.value("endDate").toString(),Qt::ISODate)<quantPluginUi::today(),"结束日期必须早于上海当地今天");}
    repository_.configure(pluginId_,runtime_->text(),true);
    QJsonObject policy{{"closedBarsOnly",closed_->isChecked()},{"knownEventsOnly",closed_->isChecked()},{"knownValuationsOnly",closed_->isChecked()},{"knownObservationsOnly",closed_->isChecked()},{"knownQuotesOnly",closed_->isChecked()},{"adjustment",adjustment_->currentData().toString()},{"timezone","unspecified"},{"volumeUnit","unspecified"},{"source","user-selected local CSV"}};
    auto path=input_->text();if(operation_.value("inputKind")=="ohlcv-single-csv"&&!datasets_->currentData().toString().isEmpty()){
        auto saved=job_.marketDataInput(datasets_->currentData().toString());path=saved.value("path").toString();policy=saved.value("policy").toObject();
    }
    job_.start(pluginId_,operation_.value("id").toString(),path,args,policy,timeout_->value());
}
