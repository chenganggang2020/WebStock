#include "quant_plugin_widget.hpp"
#include "quant_plugin_ui.hpp"
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
#include <QDialog>
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
        static const QMap<QString,QString> labels{{"time","日期"},{"symbol","股票代码"},{"open","开盘价"},{"high","最高价"},{"low","最低价"},{"close","收盘价"},{"volume","成交量（股）"},{"amount","成交额（元）"},{"priceadjustment","复权口径"},{"source","来源"},{"acquiredatutc","采集时间 UTC"},{"volumeunit","量单位"},{"amountunit","额单位"},{"timezone","时区"},{"isclosed","已完成日线"}};
        return o==Qt::Horizontal?QVariant(labels.value(columns_[section].toString(),columns_[section].toString())):QVariant(section+1);
    }
};
class SeriesPlot : public QWidget {
    QJsonArray rows_;
    int column_=1;
    bool bars_=false;
public:
    explicit SeriesPlot(QJsonArray rows,QWidget* parent):QWidget(parent),rows_(rows){setMinimumHeight(190);}
    void setColumn(int column){column_=column;update();}
    void setBars(){bars_=true;setMinimumHeight(105);update();}
protected:
    void paintEvent(QPaintEvent*) override {
        QPainter p(this);p.fillRect(rect(),palette().base());p.setRenderHint(QPainter::Antialiasing);
        QRectF area(95,18,std::max(10,width()-120),std::max(10,height()-55));
        double low=std::numeric_limits<double>::infinity(),high=-low;int first=-1,last=-1;
        for(int i=0;i<rows_.size();++i) {auto v=rows_[i].toArray().at(column_);if(v.isDouble()){if(first<0)first=i;last=i;low=std::min(low,v.toDouble());high=std::max(high,v.toDouble());}}
        p.setPen(palette().text().color());
        if(!std::isfinite(low)){p.drawText(area,Qt::AlignCenter,"此列没有有效数值（可能预热不足）");return;}
        if(bars_)low=0;
        if(high==low){high+=std::max(1.,std::abs(high)*.01);if(!bars_)low-=std::max(1.,std::abs(low)*.01);}
        const auto highText=QString::number(high,'g',8),lowText=QString::number(low,'g',8);
        const int labelWidth=std::max(90,std::max(p.fontMetrics().horizontalAdvance(highText),p.fontMetrics().horizontalAdvance(lowText))+8);
        area=QRectF(labelWidth+8,18,std::max(10,width()-labelWidth-33),std::max(10,height()-55));
        p.setPen(palette().mid().color());p.drawRect(area);p.setPen(palette().text().color());
        p.drawText(QRectF(0,10,labelWidth,25),Qt::AlignRight,highText);
        p.drawText(QRectF(0,area.bottom()-15,labelWidth,25),Qt::AlignRight,lowText);
        QPainterPath path;QList<QPointF> isolated;
        // Fit the visible axis to this column's observed interval. Process each
        // contiguous segment separately so pixel buckets cannot bridge a gap.
        int count=last-first+1;int bucket=std::max(1,count/std::max(1,int(area.width())));
        auto pointAt=[&](int i){return QPointF(area.left()+area.width()*(i-first)/std::max(1,count-1),area.bottom()-area.height()*(rows_[i].toArray()[column_].toDouble()-low)/(high-low));};
        if(bars_){
            p.setPen(QPen(QColor("#479f9a"),std::max(1.,std::min(4.,area.width()/std::max(1,count)*.7))));
            for(int start=first;start<=last;start+=bucket){int maximum=start;for(int i=start;i<std::min(last+1,start+bucket);++i)if(rows_[i].toArray().at(column_).toDouble()>rows_[maximum].toArray().at(column_).toDouble())maximum=i;auto point=pointAt(maximum);p.drawLine(QPointF(point.x(),area.bottom()),point);}
            p.setPen(palette().text().color());p.drawText(QRectF(area.left(),area.bottom()+5,area.width()/2,25),rows_[first].toArray().first().toVariant().toString());p.drawText(QRectF(area.center().x(),area.bottom()+5,area.width()/2,25),Qt::AlignRight,rows_[last].toArray().first().toVariant().toString());return;
        }
        for(int segment=first;segment<=last;){
            if(!rows_[segment].toArray().at(column_).isDouble()){++segment;continue;}
            int stop=segment+1;while(stop<=last&&rows_[stop].toArray().at(column_).isDouble())++stop;
            path.moveTo(pointAt(segment));if(stop==segment+1)isolated.append(pointAt(segment));
            for(int start=segment;start<stop;start+=bucket){
                int end=std::min(stop,start+bucket),minIndex=start,maxIndex=start;double a=INFINITY,b=-INFINITY;
                for(int i=start;i<end;++i){const double value=rows_[i].toArray().at(column_).toDouble();if(value<a){a=value;minIndex=i;}if(value>b){b=value;maxIndex=i;}}
                QList<int> indices{start,minIndex,maxIndex,end-1};std::sort(indices.begin(),indices.end());
                for(int i:indices)path.lineTo(pointAt(i));
            }
            segment=stop;
        }
        p.setPen(QPen(QColor("#28a5db"),1.7));p.drawPath(path);
        for(auto point:isolated)p.drawEllipse(point,3,3);
        p.setPen(palette().text().color());p.drawText(QRectF(area.left(),area.bottom()+5,area.width()/2,25),rows_[first].toArray().first().toVariant().toString());
        p.drawText(QRectF(area.center().x(),area.bottom()+5,area.width()/2,25),Qt::AlignRight,rows_[last].toArray().first().toVariant().toString());
    }
};
class PriceDistributionPlot : public QWidget {
    QJsonArray rows_;
    int lower_,upper_,volume_,valueArea_;
    bool costModel_;
public:
    explicit PriceDistributionPlot(const QJsonObject& table,QWidget* parent):QWidget(parent),rows_(table.value("rows").toArray()),costModel_(table.value("id")=="model-cost-profile"){
        auto columns=table.value("columns").toArray();
        lower_=columns.toVariantList().indexOf("priceLower");upper_=columns.toVariantList().indexOf("priceUpper");
        volume_=columns.toVariantList().indexOf(costModel_?"modelWeight":"volumeShares");valueArea_=columns.toVariantList().indexOf(costModel_?"inCentral70":"inValueArea");setMinimumHeight(250);
        if(costModel_)setObjectName("pluginCostProfile");
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
        p.drawText(QRectF(area.left(),area.bottom()+7,area.width(),25),costModel_?QString("模型权重（非真实持仓）；蓝色与中央70%区间相交 · 最大箱 %1%").arg(QString::number(maximum*100,'g',6)):QString("成交股数（逐价格箱）；蓝色为价值区间 · 最大箱 %1 股").arg(QString::number(maximum,'g',10)));
        double height=area.height()/rows_.size();
        for(int i=0;i<rows_.size();++i){auto row=rows_[i].toArray();
            p.fillRect(QRectF(area.left(),area.bottom()-(i+1)*height,area.width()*row.at(volume_).toDouble()/maximum,std::max(.25,height*.9)),
                row.at(valueArea_).toBool()?QColor("#28a5db"):palette().mid().color());
        }
    }
};
}
void QuantPluginWidget::showResult(const QString& id,bool fresh){
    QJsonObject record;
    if(id.startsWith("shared:")){auto input=job_.marketDataInput(id);auto result=input["result"].toObject();record={{"pluginId",pluginId_},{"operationId","daily-eastmoney"},{"status","completed"},{"result",result},{"request",QJsonObject{{"parameters",result["parameters"]}}}};history_->setCurrentRow(-1);}
    else record=job_.reopen(id);quantPlugin::require(record.value("pluginId")==pluginId_,"此记录属于其他插件，请打开对应插件的历史");
    while(results_->count()){auto w=results_->widget(0);results_->removeTab(0);w->deleteLater();}
    for(int i=0;i<history_->count();++i)if(history_->item(i)->data(Qt::UserRole).toString()==id)history_->setCurrentRow(i);
    auto result=record.value("result").toObject();
    const bool market=pluginId_=="org.webstock.akshare"&&record.value("operationId")=="daily-eastmoney";
    const bool pending=QStringList{"starting","running"}.contains(record.value("status").toString());
    const auto query=record.value("request").toObject().value("parameters").toObject();
    if(result.isEmpty()){
        auto panel=new QWidget;auto layout=new QVBoxLayout(panel);auto heading=new QLabel(market?(pending?"正在获取行情…":"本次行情未获取成功"):statusText(record.value("status").toString()));heading->setStyleSheet("font-size:20px;font-weight:600;");layout->addWidget(heading);
        auto reason=new QLabel(pending?"请求已记录，正在等待数据源返回，可随时取消。":market?quantPluginUi::failure(record):record.value("message").toString());reason->setObjectName(pending?"pluginPendingRequest":"pluginFailureReason");reason->setTextFormat(Qt::PlainText);reason->setWordWrap(true);layout->addWidget(reason);
        if(market){auto request=new QLabel(QString("股票 %1 · %2\n请求区间：%3 至 %4\n发起时间：%5\n%6").arg(query.value("symbol").toString(),quantPluginUi::adjustment(query.value("adjustment").toString()),query.value("startDate").toString(),query.value("endDate").toString(),quantPluginUi::time(record.value("createdAt").toString()),pending?"来源：AKShare / 东方财富；这次请求还没有返回新行情。":"没有用缓存或合成数据替代这次请求。"));request->setWordWrap(true);layout->addWidget(request);
            if(!historyOnly_&&!pending){auto retry=new QPushButton("按以上条件重新获取行情");retry->setObjectName("pluginRetry");retry->setEnabled(!isRunning());layout->addWidget(retry,0,Qt::AlignLeft);connect(retry,&QPushButton::clicked,this,[this,query]{guard([this,query]{restoreQuery(query);sourceChoice_->setCurrentIndex(sourceChoice_->findData("akshare-eastmoney"));startSharedHistory(true);});});}
        }
        layout->addStretch();results_->addTab(panel,market?"获取结果":"运行状态");
    }
    const QString historicalCaution=result.value("pluginId")=="org.webstock.hikyuu"&&result.value("formulaVersion")=="hikyuu-sma-cross-next-open-v1"
        ?QString("此旧版Hikyuu结果存在已确认的日期转换错误，资金曲线不可用于分析。请用0.26.0或更新插件重新运行；下方仅保留原始归档供核对。") : QString();
    for(auto v:result.value("tables").toArray()){auto table=v.toObject();auto panel=new QWidget;auto layout=new QVBoxLayout(panel);
        const bool marketTable=market&&table.value("id")=="market-data";
        if(marketTable){
            auto source=result.value("provenance").toObject();auto summary=new QLabel;
            summary->setObjectName("pluginMarketSummary");summary->setTextFormat(Qt::PlainText);summary->setWordWrap(true);
            summary->setText(QString("%1\n证券 %2 · %3 · %4 根已完成K线\n请求区间：%5 至 %6\n实际返回：%7 至 %8\n来源：%9 · 最近采集时间：%10")
                .arg(fresh?(id.startsWith("shared:")?"本次更新已完成 · 预览为合并后的公共行情":"本次联网返回 · 已保存到行情档案"):"已保存历史行情 · 非本次联网获取",quantPluginUi::security(source["identity"].toObject()["securityId"].toString(query.value("symbol").toString())),quantPluginUi::adjustment(query.value("adjustment").toString())).arg(result.value("bars").toInt())
                .arg(source.value("requestedStart").toString(),source.value("requestedEnd").toString(),source.value("firstReturnedDate").toString(),source.value("lastReturnedDate").toString(),source.value("providerLabel").toString("AKShare / 东方财富"),quantPluginUi::time(source.value("acquiredAtUtc").toString())));
            layout->addWidget(summary);
            auto actions=new QHBoxLayout;auto save=new QPushButton("导出行情 CSV…");save->setObjectName("pluginSaveMarketData");actions->addWidget(save);
            connect(save,&QPushButton::clicked,this,[this,result]{guard([this,result]{auto artifact=result.value("generatedData").toObject();auto bytes=quantPlugin::generatedData(artifact);auto path=QFileDialog::getSaveFileName(this,"导出已校验的历史行情",artifact.value("name").toString(),"CSV (*.csv)");if(!path.isEmpty()){quantPlugin::write(path,bytes);status_->setText("行情 CSV 已导出。来源和采集信息保留在公共行情库或原始插件档案中。");}});});
            auto consumers=new QComboBox;consumers->setObjectName("pluginDataConsumer");consumers->setMinimumContentsLength(15);consumers->setSizeAdjustPolicy(QComboBox::AdjustToMinimumContentsLengthWithIcon);
            for(auto p:repository_.plugins()){
                auto entry=p.toObject();if(!entry.value("enabled").toBool())continue;
                try{auto manifest=repository_.plugin(entry.value("id").toString()).value("manifest").toObject();bool compatible=false;for(auto op:manifest.value("operations").toArray())if(op.toObject().value("inputKind")=="ohlcv-single-csv")compatible=true;
                    if(compatible)consumers->addItem(entry.value("name").toString(),entry.value("id").toString());}catch(const std::exception&){}
            }
            actions->addWidget(consumers,1);auto use=new QPushButton("交给指标 / 回测");use->setObjectName("pluginUseMarketData");use->setEnabled(consumers->count()>0);actions->addWidget(use);layout->addLayout(actions);
            connect(use,&QPushButton::clicked,this,[this,consumers,id]{guard([this,consumers,id]{auto target=consumers->currentData().toString();if(openDataConsumer)openDataConsumer(target,id);else {auto dialog=new QDialog(this);dialog->setAttribute(Qt::WA_DeleteOnClose);dialog->resize(1320,900);auto layout=new QVBoxLayout(dialog);auto widget=new QuantPluginWidget(repository_.root(),dialog,target);layout->addWidget(widget);widget->useSavedData(id);dialog->setWindowTitle("WebStock · "+consumers->currentText());dialog->show();}});});
            auto rows=table.value("rows").toArray();auto columns=table.value("columns").toArray().toVariantList();auto close=columns.indexOf("close"),volume=columns.indexOf("volume");
            if(close>=0){layout->addWidget(new QLabel("收盘价（元，按所选复权口径）"));auto plot=new SeriesPlot(rows,panel);plot->setObjectName("pluginPricePlot");plot->setMinimumHeight(130);plot->setColumn(close);layout->addWidget(plot);}
            if(volume>=0){layout->addWidget(new QLabel("成交量（股）"));auto plot=new SeriesPlot(rows,panel);plot->setObjectName("pluginVolumePlot");plot->setBars();plot->setColumn(volume);layout->addWidget(plot);}
        }
        if(!historicalCaution.isEmpty()){auto notice=new QLabel(historicalCaution);notice->setObjectName("pluginHistoricalCaution");notice->setTextFormat(Qt::PlainText);notice->setWordWrap(true);notice->setStyleSheet("background:#533c18;color:#ffe2a8;padding:10px;");layout->addWidget(notice);}
        auto saveTable=new QPushButton("导出此表 CSV");layout->addWidget(saveTable,0,Qt::AlignLeft);saveTable->setVisible(!marketTable);
        connect(saveTable,&QPushButton::clicked,this,[this,table]{guard([this,table]{auto path=QFileDialog::getSaveFileName(this,"导出当前结果表",table.value("id").toString()+".csv","CSV (*.csv)");if(!path.isEmpty())quantPlugin::write(path,quantPlugin::tableCsv(table));});});
        if(!marketTable&&(QStringList{"indicators","equity","weight-index","native-dsb-bars","market-data"}.contains(table.value("id").toString())||table.value("id").toString().startsWith("features-"))){
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
        if(table.value("id")=="selected-range-profile"||table.value("id")=="model-cost-profile")layout->addWidget(new PriceDistributionPlot(table,panel));
        auto view=new QTableView;view->setObjectName(marketTable?"pluginMarketTable":"pluginResultTable");view->setModel(new ResultModel(table,view));view->horizontalHeader()->setSectionResizeMode(QHeaderView::Interactive);view->horizontalHeader()->setDefaultSectionSize(marketTable?105:150);view->setMinimumHeight(125);view->setAlternatingRowColors(false);view->setSelectionBehavior(QAbstractItemView::SelectRows);layout->addWidget(view,1);
        auto id=table.value("id").toString();
        results_->addTab(panel,id=="market-data"?"行情预览":id=="provider-return"?"数据源原始返回":id=="indicators"?"指标曲线与明细":id=="equity"?"权益曲线":id=="weight-index"?"权重单利指数":id=="daily-attribution"?"每日收益归因":id=="model-cost-profile"?"成本分布（模型）":id);
    }
    if(result.contains("generatedData")&&!market){
        auto artifact=result.value("generatedData").toObject();auto panel=new QWidget;auto layout=new QVBoxLayout(panel);
        auto description=new QLabel("本次生成的文件："+artifact.value("name").toString()+"\nSHA256："+artifact.value("sha256").toString());description->setTextFormat(Qt::PlainText);description->setWordWrap(true);layout->addWidget(description);
        auto save=new QPushButton("保存生成的数据文件");layout->addWidget(save);layout->addStretch();
        connect(save,&QPushButton::clicked,this,[this,artifact]{guard([this,artifact]{auto bytes=quantPlugin::generatedData(artifact);auto path=QFileDialog::getSaveFileName(this,"保存生成的数据文件",artifact.value("name").toString(),"数据文件 (*)");if(!path.isEmpty())quantPlugin::write(path,bytes);});});
        results_->addTab(panel,"生成的数据文件");
    }
    auto detail=new QPlainTextEdit;detail->setReadOnly(true);auto metadata=result;metadata.remove("tables");if(metadata.isEmpty())metadata=record;
    if(!historicalCaution.isEmpty())metadata["viewerCaution"]=historicalCaution;
    if(metadata.contains("generatedData")){auto artifact=metadata.value("generatedData").toObject();artifact.remove("base64");metadata["generatedData"]=artifact;}
    detail->setPlainText(QString::fromUtf8(QJsonDocument(metadata).toJson(QJsonDocument::Indented)));results_->addTab(detail,"版本、数据与诊断");
    QStringList warnings;for(auto w:result.value("warnings").toArray())warnings<<w.toString();
    if(!historicalCaution.isEmpty())warnings.prepend(historicalCaution);
    if(market)status_->setText(pending?"正在等待新行情返回…":result.isEmpty()?quantPluginUi::failure(record):(fresh?"获取成功，行情及来源已保存。":"当前显示已保存的历史行情，未发起联网请求。")+QString("采集时快照不代表历史当时可见数据；复权序列可能修订。"));
    else status_->setText(statusText(record.value("status").toString())+"。"+warnings.join(" ")+record.value("message").toString());
}
