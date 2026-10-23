#include "quant_plugin_widget.hpp"
#include <QAbstractTableModel>
#include <QCheckBox>
#include <QComboBox>
#include <QDoubleSpinBox>
#include <QFileDialog>
#include <QFormLayout>
#include <QHeaderView>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QPainter>
#include <QPainterPath>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QScrollArea>
#include <QSignalBlocker>
#include <QSpinBox>
#include <QSplitter>
#include <QTableView>
#include <QTabWidget>
#include <QVBoxLayout>
#include <QJsonDocument>
#include <cmath>
#include <limits>

namespace {
QString statusText(QString s) {
    static const QMap<QString,QString> names{{"starting","正在启动"},{"running","正在计算"},{"completed","已完成并校验"},
        {"failed","运行失败"},{"cancelled","已取消"},{"timed_out","已超时"},{"interrupted","上次已中断"},
        {"damaged","记录损坏"},{"storage_failed","保存失败"},{"process_isolation_failed","进程隔离失败"}};
    return names.value(s,s);
}
class ResultModel : public QAbstractTableModel {
    QJsonArray columns_, rows_;
public:
    ResultModel(const QJsonObject& table,QObject* parent):QAbstractTableModel(parent),columns_(table.value("columns").toArray()),rows_(table.value("rows").toArray()){}
    int rowCount(const QModelIndex& p={})const override{return p.isValid()?0:rows_.size();}
    int columnCount(const QModelIndex& p={})const override{return p.isValid()?0:columns_.size();}
    QVariant data(const QModelIndex& i,int role)const override {
        if(!i.isValid()||role!=Qt::DisplayRole) return {};
        auto v=rows_[i.row()].toArray()[i.column()];if(v.isNull())return QString("—");
        if(v.isDouble())return QString::number(v.toDouble(),'g',12);
        return v.toVariant();
    }
    QVariant headerData(int section,Qt::Orientation o,int role)const override {
        if(role!=Qt::DisplayRole)return {};
        return o==Qt::Horizontal?QVariant(columns_[section].toString()):QVariant(section+1);
    }
};
class SeriesPlot : public QWidget {
    QJsonArray rows_;
    int column_=1;
public:
    explicit SeriesPlot(QJsonArray rows,QWidget* parent):QWidget(parent),rows_(rows){setMinimumHeight(190);}
    void setColumn(int column){column_=column;update();}
protected:
    void paintEvent(QPaintEvent*) override {
        QPainter p(this);p.fillRect(rect(),palette().base());p.setRenderHint(QPainter::Antialiasing);
        QRectF area(95,18,std::max(10,width()-120),std::max(10,height()-55));
        double low=std::numeric_limits<double>::infinity(),high=-low;
        for(auto row:rows_) {auto v=row.toArray().at(column_);if(v.isDouble()){low=std::min(low,v.toDouble());high=std::max(high,v.toDouble());}}
        p.setPen(palette().text().color());
        if(!std::isfinite(low)){p.drawText(area,Qt::AlignCenter,"此列没有有效数值（可能预热不足）");return;}
        if(high==low){high+=std::max(1.,std::abs(high)*.01);low-=std::max(1.,std::abs(low)*.01);}
        const auto highText=QString::number(high,'g',8),lowText=QString::number(low,'g',8);
        const int labelWidth=std::max(90,std::max(p.fontMetrics().horizontalAdvance(highText),p.fontMetrics().horizontalAdvance(lowText))+8);
        area=QRectF(labelWidth+8,18,std::max(10,width()-labelWidth-33),std::max(10,height()-55));
        p.setPen(palette().mid().color());p.drawRect(area);p.setPen(palette().text().color());
        p.drawText(QRectF(0,10,labelWidth,25),Qt::AlignRight,highText);
        p.drawText(QRectF(0,area.bottom()-15,labelWidth,25),Qt::AlignRight,lowText);
        QPainterPath path;bool gap=true;
        // Preserve gaps and extrema in pixel buckets rather than selecting every Nth bar.
        int count=rows_.size();int bucket=std::max(1,count/std::max(1,int(area.width())));
        for(int start=0;start<count;start+=bucket) {
            int end=std::min(count,start+bucket),minIndex=start,maxIndex=start;double a=INFINITY,b=-INFINITY;bool missing=false;
            for(int i=start;i<end;++i){auto value=rows_[i].toArray().at(column_);if(!value.isDouble()){missing=true;continue;}
                if(value.toDouble()<a){a=value.toDouble();minIndex=i;}if(value.toDouble()>b){b=value.toDouble();maxIndex=i;}}
            if(missing)gap=true;if(!std::isfinite(a))continue;
            QList<int> indices{minIndex,maxIndex};std::sort(indices.begin(),indices.end());
            for(int i:indices){double value=rows_[i].toArray()[column_].toDouble();QPointF point(area.left()+area.width()*i/std::max(1,count-1),area.bottom()-area.height()*(value-low)/(high-low));
                if(gap){path.moveTo(point);gap=false;}else path.lineTo(point);}
        }
        p.setPen(QPen(QColor("#28a5db"),1.7));p.drawPath(path);
        if(count==1&&rows_[0].toArray().at(column_).isDouble()){
            const auto value=rows_[0].toArray().at(column_).toDouble();
            p.drawEllipse(QPointF(area.left(),area.bottom()-area.height()*(value-low)/(high-low)),3,3);
        }
        if(!rows_.isEmpty()){p.setPen(palette().text().color());p.drawText(QRectF(area.left(),area.bottom()+5,area.width()/2,25),rows_.first().toArray().first().toVariant().toString());
            p.drawText(QRectF(area.center().x(),area.bottom()+5,area.width()/2,25),Qt::AlignRight,rows_.last().toArray().first().toVariant().toString());}
    }
};
class VolumeProfilePlot : public QWidget {
    QJsonArray rows_;
    int lower_,upper_,volume_,valueArea_;
public:
    explicit VolumeProfilePlot(const QJsonObject& table,QWidget* parent):QWidget(parent),rows_(table.value("rows").toArray()){
        auto columns=table.value("columns").toArray();
        lower_=columns.toVariantList().indexOf("priceLower");upper_=columns.toVariantList().indexOf("priceUpper");
        volume_=columns.toVariantList().indexOf("volumeShares");valueArea_=columns.toVariantList().indexOf("inValueArea");setMinimumHeight(250);
    }
protected:
    void paintEvent(QPaintEvent*) override {
        QPainter p(this);p.fillRect(rect(),palette().base());
        if(rows_.isEmpty()||lower_<0||upper_<0||volume_<0||valueArea_<0)return;
        const auto upperText=QString::number(rows_.last().toArray().at(upper_).toDouble(),'g',10);
        const auto lowerText=QString::number(rows_.first().toArray().at(lower_).toDouble(),'g',10);
        const int labelWidth=std::max(90,std::max(p.fontMetrics().horizontalAdvance(upperText),p.fontMetrics().horizontalAdvance(lowerText))+8);
        QRectF area(labelWidth+8,25,std::max(10,width()-labelWidth-33),std::max(10,height()-65));
        double maximum=0;for(auto row:rows_)maximum=std::max(maximum,row.toArray().at(volume_).toDouble());
        if(maximum<=0)return;
        p.setPen(palette().mid().color());p.drawRect(area);p.setPen(palette().text().color());
        p.drawText(QRectF(0,area.top()-12,labelWidth,25),Qt::AlignRight,upperText);
        p.drawText(QRectF(0,area.bottom()-12,labelWidth,25),Qt::AlignRight,lowerText);
        p.drawText(QRectF(area.left(),area.bottom()+7,area.width(),25),QString("成交股数（逐价格箱）；蓝色为价值区间 · 最大箱 %1 股").arg(QString::number(maximum,'g',10)));
        double height=area.height()/rows_.size();
        for(int i=0;i<rows_.size();++i){auto row=rows_[i].toArray();
            p.fillRect(QRectF(area.left(),area.bottom()-(i+1)*height,area.width()*row.at(volume_).toDouble()/maximum,std::max(.25,height*.9)),
                row.at(valueArea_).toBool()?QColor("#28a5db"):palette().mid().color());
        }
    }
};
}
QuantPluginWidget::QuantPluginWidget(QString root,QWidget* parent):QWidget(parent),repository_(root),job_(root,this) {
    setObjectName("quantPluginWidget");auto layout=new QVBoxLayout(this);
    auto heading=new QLabel("量化插件 · 安装、指标计算与历史回测");heading->setStyleSheet("font-size:18px;font-weight:600;");layout->addWidget(heading);
    auto bar=new QHBoxLayout;auto install=new QPushButton("安装插件包");auto configure=new QPushButton("保存运行环境");
    auto cancel=new QPushButton("取消运行");run_=new QPushButton("运行所选功能");run_->setObjectName("pluginRun");
    auto uninstall=new QPushButton("卸载所选插件");auto exportResult=new QPushButton("导出结果包");auto importResult=new QPushButton("导入结果包");
    bar->addWidget(install);bar->addWidget(configure);bar->addWidget(uninstall);bar->addWidget(exportResult);bar->addWidget(importResult);bar->addStretch();bar->addWidget(run_);bar->addWidget(cancel);layout->addLayout(bar);
    auto splitter=new QSplitter;layout->addWidget(splitter,1);auto scroll=new QScrollArea;scroll->setWidgetResizable(true);scroll->setMinimumWidth(320);
    auto panel=new QWidget;auto form=new QFormLayout(panel);form_=form;scroll->setWidget(panel);splitter->addWidget(scroll);
    plugins_=new QComboBox;plugins_->setObjectName("pluginPicker");form->addRow("插件",plugins_);
    enabled_=new QCheckBox("启用此插件");form->addRow(enabled_);
    connect(enabled_,&QCheckBox::toggled,this,[this](bool checked){enabled_->setText(checked?"已启用此插件":"此插件已停用");});
    auto pathRow=[&](const QString& title,QLineEdit*& edit,const QString& filter){
        auto row=new QWidget;auto h=new QHBoxLayout(row);h->setContentsMargins(0,0,0,0);edit=new QLineEdit;auto choose=new QPushButton("选择");h->addWidget(edit,1);h->addWidget(choose);form->addRow(title,row);
        connect(choose,&QPushButton::clicked,this,[this,edit,title,filter]{auto file=QFileDialog::getOpenFileName(this,title,{},filter);if(!file.isEmpty())edit->setText(file);});
    };
    pathRow("独立Python环境",runtime_,"Python (python.exe);;所有文件 (*)");runtime_->setObjectName("pluginRuntime");
    filter_=new QLineEdit;filter_->setPlaceholderText("按名称搜索指标或功能");form->addRow("搜索",filter_);
    operations_=new QComboBox;operations_->setObjectName("pluginOperation");operations_->setSizeAdjustPolicy(QComboBox::AdjustToMinimumContentsLengthWithIcon);operations_->setMinimumContentsLength(18);form->addRow("功能",operations_);
    description_=new QLabel;description_->setTextFormat(Qt::PlainText);description_->setWordWrap(true);form->addRow(description_);
    pathRow("历史K线 CSV",input_,"CSV (*.csv)");input_->setObjectName("pluginInput");
    adjustment_=new QComboBox;for(auto pair:QList<QPair<QString,QString>>{{"尚未核实","unknown"},{"不复权","unadjusted"},{"前复权","forward"},{"后复权","backward"}})adjustment_->addItem(pair.first,pair.second);form->addRow("价格口径",adjustment_);
    closed_=new QCheckBox("确认输入仅包含已完成的K线");closed_->setObjectName("pluginClosedBars");form->addRow(closed_);
    connect(closed_,&QCheckBox::toggled,this,[this](bool checked){
        const bool events=operation_.value("inputKind")=="market-events-csv";
        closed_->setText(events?(checked?"已确认：事件已发生且当时可知":"确认输入事件已发生且当时可知"):(checked?"已确认：仅包含已完成K线":"确认输入仅包含已完成的K线"));});
    timeout_=new QSpinBox;timeout_->setRange(5,3600);timeout_->setValue(600);form->addRow("最长运行秒数",timeout_);
    auto parameterPanel=new QWidget;parameters_=new QFormLayout(parameterPanel);parameters_->setContentsMargins(0,0,0,0);form->addRow(parameterPanel);
    auto right=new QWidget;auto rightLayout=new QVBoxLayout(right);history_=new QListWidget;history_->setObjectName("pluginHistory");history_->setMaximumHeight(140);rightLayout->addWidget(history_);
    results_=new QTabWidget;results_->setObjectName("pluginResults");rightLayout->addWidget(results_,1);splitter->addWidget(right);splitter->setStretchFactor(1,3);
    status_=new QLabel("安装插件后，选择独立运行环境和本地历史数据。进入本页不会启动任务。");status_->setTextFormat(Qt::PlainText);status_->setWordWrap(true);status_->setObjectName("pluginStatus");layout->addWidget(status_);
    connect(install,&QPushButton::clicked,this,[this]{guard([this]{auto file=QFileDialog::getOpenFileName(this,"安装WebStock插件",{},"WebStock 插件 (*.wspkg)");if(file.isEmpty())return;
        auto p=repository_.install(quantPlugin::read(file));refreshPlugins();plugins_->setCurrentIndex(plugins_->findData(p.value("id").toString()));status_->setText("插件已安装，请选择它的独立运行环境。包内为可执行代码，仅安装可信来源。");});});
    connect(configure,&QPushButton::clicked,this,[this]{guard([this]{repository_.configure(plugins_->currentData().toString(),runtime_->text(),enabled_->isChecked());status_->setText("插件运行环境与启用状态已保存。");});});
    connect(uninstall,&QPushButton::clicked,this,[this]{guard([this]{quantPlugin::require(!job_.active(),"请等待或取消本窗口任务后卸载");repository_.uninstall(plugins_->currentData().toString());refreshPlugins();status_->setText("插件已从可运行列表移除。历史结果与版本缓存保留，可重新安装恢复。");});});
    connect(exportResult,&QPushButton::clicked,this,[this]{guard([this]{auto item=history_->currentItem();quantPlugin::require(item,"请在历史中选择已完成结果");auto bytes=job_.exportResult(item->data(Qt::UserRole).toString());auto path=QFileDialog::getSaveFileName(this,"导出含冻结输入的结果包",{},"WebStock 结果 (*.wsresult)");if(!path.isEmpty()){quantPlugin::write(path,bytes);status_->setText("完整结果包已导出，包含本次冻结的输入数据与适配代码。");}});});
    connect(importResult,&QPushButton::clicked,this,[this]{guard([this]{auto path=QFileDialog::getOpenFileName(this,"导入结果包",{},"WebStock 结果 (*.wsresult)");if(path.isEmpty())return;auto id=job_.importResult(quantPlugin::read(path,68*1024*1024));refreshHistory();showResult(id);});});
    connect(plugins_,&QComboBox::currentIndexChanged,this,[this]{guard([this]{selectPlugin();});});
    connect(filter_,&QLineEdit::textChanged,this,[this]{guard([this]{filterOperations();});});
    connect(operations_,&QComboBox::currentIndexChanged,this,[this]{guard([this]{selectOperation();});});
    connect(run_,&QPushButton::clicked,this,[this]{guard([this]{start();});});connect(cancel,&QPushButton::clicked,this,[this]{job_.cancel();});
    connect(history_,&QListWidget::itemClicked,this,[this](QListWidgetItem* item){guard([this,item]{showResult(item->data(Qt::UserRole).toString());});});
    job_.progress=[this](QString message){status_->setText(message);};
    job_.changed=[this]{refreshHistory();run_->setEnabled(!job_.active());auto r=job_.current();status_->setText(statusText(r.value("status").toString())+" · "+r.value("message").toString());
        if(r.value("status")=="completed")guard([this,r]{showResult(r.value("runId").toString());});};
    guard([this]{refreshPlugins();refreshHistory();});
}
QuantPluginWidget::~QuantPluginWidget(){job_.changed={};job_.progress={};job_.cancel();}
void QuantPluginWidget::guard(std::function<void()> action){try{action();}catch(const std::exception& e){status_->setText(QString::fromUtf8(e.what()));}}
void QuantPluginWidget::refreshPlugins(){QSignalBlocker block(plugins_);auto selected=plugins_->currentData();plugins_->clear();for(auto v:repository_.plugins()){auto p=v.toObject();plugins_->addItem(p.value("name").toString()+" / "+p.value("version").toString(),p.value("id"));}int i=plugins_->findData(selected);if(i>=0)plugins_->setCurrentIndex(i);selectPlugin();}
void QuantPluginWidget::selectPlugin(){
    if(plugins_->currentIndex()<0){QSignalBlocker block(operations_);operations_->clear();runtime_->clear();enabled_->setChecked(false);selectOperation();return;}
    auto p=repository_.plugin(plugins_->currentData().toString());runtime_->setText(p.value("runtimePath").toString());enabled_->setChecked(p.value("enabled").toBool());
    filterOperations();
}
void QuantPluginWidget::filterOperations(){
    QSignalBlocker block(operations_);auto previous=operation_.value("id").toString();operations_->clear();if(plugins_->currentIndex()<0)return;
    auto p=repository_.plugin(plugins_->currentData().toString());
    for(auto v:p.value("manifest").toObject().value("operations").toArray()){auto op=v.toObject();if(op.value("title").toString().contains(filter_->text(),Qt::CaseInsensitive))operations_->addItem(op.value("title").toString(),op);}
    for(int i=0;i<operations_->count();++i)if(operations_->itemData(i).toJsonObject().value("id")==previous)operations_->setCurrentIndex(i);
    selectOperation();
}
void QuantPluginWidget::selectOperation(){
    fields_.clear();while(parameters_->rowCount())parameters_->removeRow(0);
    operation_=operations_->currentData().toJsonObject();description_->setText(operation_.value("description").toString());
    const bool query=operation_.value("inputKind")=="parameters-only";
    const bool events=operation_.value("inputKind")=="market-events-csv";
    form_->setRowVisible(input_->parentWidget(),!query);form_->setRowVisible(adjustment_,operation_.value("inputKind")=="ohlcv-single-csv");form_->setRowVisible(closed_,!query);
    closed_->setChecked(false);
    closed_->setText(events?"确认输入事件已发生且当时可知":"确认输入仅包含已完成的K线");
    if(auto label=qobject_cast<QLabel*>(form_->labelForField(input_->parentWidget())))
        label->setText(events?"逐笔成交 / 盘口 CSV":operation_.value("inputKind")=="market-panel-csv"?"历史多证券 CSV":"历史K线 CSV");
    QJsonObject saved;
    if(!operation_.isEmpty()){
        auto p=repository_.plugin(plugins_->currentData().toString());
        try{saved=quantPlugin::validateParameters(operation_,p.value("parametersByOperation").toObject().value(operation_.value("id").toString()).toObject());}
        catch(const std::exception&){/* An older version's parameters may no longer be valid. */}
    }
    for(auto v:operation_.value("parameters").toArray()){auto f=v.toObject();QWidget* field;
        if(saved.contains(f.value("id").toString()))f["default"]=saved.value(f.value("id").toString());
        if(f.value("type")=="choice"){auto box=new QComboBox;for(auto x:f.value("choices").toArray())box->addItem(x.toVariant().toString(),x.toVariant());box->setCurrentIndex(box->findData(f.value("default").toVariant()));field=box;}
        else if(f.value("type")=="text"){auto edit=new QLineEdit(f.value("default").toString());edit->setMaxLength(f.value("maxLength").toInt());if(f.value("format")=="date")edit->setPlaceholderText("YYYY-MM-DD");field=edit;}
        else {
            auto spin=new QDoubleSpinBox;const bool integer=f.value("type")=="integer";int decimals=integer?0:6;
            if(!integer)for(const auto& key:QStringList{"default","minimum"}){
                const double value=std::abs(f.value(key).toDouble());
                if(value>0&&value<1)decimals=std::max(decimals,std::min(12,int(std::ceil(-std::log10(value)))+2));
            }
            spin->setDecimals(decimals);spin->setRange(f.value("minimum").toDouble(),f.value("maximum").toDouble());
            spin->setValue(f.value("default").toDouble());spin->setSingleStep(integer?1:.01);
            if(!integer)spin->setStepType(QAbstractSpinBox::AdaptiveDecimalStepType);field=spin;
        }
        field->setObjectName("pluginParam_"+f.value("id").toString());fields_[f.value("id").toString()]=field;parameters_->addRow(f.value("title").toString(),field);
    }
}
void QuantPluginWidget::refreshHistory(){history_->clear();for(auto v:job_.records()){auto r=v.toObject();auto item=new QListWidgetItem(statusText(r.value("status").toString())+" · "+r.value("pluginId").toString()+" / "+r.value("operationId").toString()+" · "+r.value("createdAt").toString(),history_);item->setData(Qt::UserRole,r.value("runId"));}}
void QuantPluginWidget::start(){
    quantPlugin::require(!operation_.isEmpty(),"请选择已安装插件的功能");
    repository_.configure(plugins_->currentData().toString(),runtime_->text(),enabled_->isChecked());QJsonObject parameters;
    for(auto i=fields_.begin();i!=fields_.end();++i){if(auto s=qobject_cast<QDoubleSpinBox*>(i.value()))parameters[i.key()]=s->value();else if(auto edit=qobject_cast<QLineEdit*>(i.value()))parameters[i.key()]=edit->text();else parameters[i.key()]=QJsonValue::fromVariant(qobject_cast<QComboBox*>(i.value())->currentData());}
    job_.start(plugins_->currentData().toString(),operation_.value("id").toString(),input_->text(),parameters,
               {{"closedBarsOnly",closed_->isChecked()},{"knownEventsOnly",closed_->isChecked()},{"adjustment",adjustment_->currentData().toString()},
                {"timezone","unspecified"},{"volumeUnit","unspecified"},{"source","user-selected local CSV"}},timeout_->value());
}
void QuantPluginWidget::showResult(const QString& id){
    auto record=job_.reopen(id);while(results_->count()){auto w=results_->widget(0);results_->removeTab(0);w->deleteLater();}
    auto result=record.value("result").toObject();
    for(auto v:result.value("tables").toArray()){auto table=v.toObject();auto panel=new QWidget;auto layout=new QVBoxLayout(panel);
        auto saveTable=new QPushButton("导出此表 CSV");layout->addWidget(saveTable,0,Qt::AlignLeft);
        connect(saveTable,&QPushButton::clicked,this,[this,table]{guard([this,table]{auto path=QFileDialog::getSaveFileName(this,"导出当前结果表",table.value("id").toString()+".csv","CSV (*.csv)");if(!path.isEmpty())quantPlugin::write(path,quantPlugin::tableCsv(table));});});
        if(QStringList{"indicators","equity","weight-index","native-dsb-bars","market-data"}.contains(table.value("id").toString())||table.value("id").toString().startsWith("features-")){
            auto select=new QComboBox;select->setObjectName("pluginPlotColumn");auto columns=table.value("columns").toArray();auto rows=table.value("rows").toArray();
            for(int i=1;i<columns.size();++i){
                if(QStringList{"sequence","symbol","session","eventtime","eventTime","reportEnd","rangeStart","rangeEnd"}.contains(columns[i].toString()))continue;
                for(auto row:rows)if(row.toArray().at(i).isDouble()){select->addItem(columns[i].toString(),i);break;}
            }
            if(select->count()){
                layout->addWidget(select);auto plot=new SeriesPlot(rows,panel);layout->addWidget(plot);
                connect(select,&QComboBox::currentIndexChanged,plot,[plot,select]{plot->setColumn(select->currentData().toInt());});
                for(int i=1;i<columns.size();++i)if(columns[i].toString()=="equity")select->setCurrentIndex(select->findData(i));
                plot->setColumn(select->currentData().toInt());
            }else delete select;
        }
        if(table.value("id")=="selected-range-profile")layout->addWidget(new VolumeProfilePlot(table,panel));
        auto view=new QTableView;view->setModel(new ResultModel(table,view));view->horizontalHeader()->setSectionResizeMode(QHeaderView::Interactive);view->horizontalHeader()->setDefaultSectionSize(150);view->setAlternatingRowColors(false);view->setSelectionBehavior(QAbstractItemView::SelectRows);layout->addWidget(view,1);
        auto id=table.value("id").toString();
        results_->addTab(panel,id=="indicators"?"指标曲线与明细":id=="equity"?"权益曲线":id=="weight-index"?"权重单利指数":id=="daily-attribution"?"每日收益归因":id);
    }
    if(result.contains("generatedData")){
        auto artifact=result.value("generatedData").toObject();auto panel=new QWidget;auto layout=new QVBoxLayout(panel);
        auto description=new QLabel("本次生成的文件："+artifact.value("name").toString()+"\nSHA256："+artifact.value("sha256").toString());description->setTextFormat(Qt::PlainText);description->setWordWrap(true);layout->addWidget(description);
        auto save=new QPushButton("保存生成的数据文件");layout->addWidget(save);layout->addStretch();
        connect(save,&QPushButton::clicked,this,[this,artifact]{guard([this,artifact]{auto bytes=quantPlugin::generatedData(artifact);auto path=QFileDialog::getSaveFileName(this,"保存生成的数据文件",artifact.value("name").toString(),"数据文件 (*)");if(!path.isEmpty())quantPlugin::write(path,bytes);});});
        results_->addTab(panel,"生成的数据文件");
    }
    auto detail=new QPlainTextEdit;detail->setReadOnly(true);auto metadata=result;metadata.remove("tables");if(metadata.isEmpty())metadata=record;
    if(metadata.contains("generatedData")){auto artifact=metadata.value("generatedData").toObject();artifact.remove("base64");metadata["generatedData"]=artifact;}
    detail->setPlainText(QString::fromUtf8(QJsonDocument(metadata).toJson(QJsonDocument::Indented)));results_->addTab(detail,"版本、数据与诊断");
    QStringList warnings;for(auto w:result.value("warnings").toArray())warnings<<w.toString();
    status_->setText(statusText(record.value("status").toString())+"。"+warnings.join(" ")+record.value("message").toString());
}
