#include "stock_extension_host.hpp"
#include "extension_input.hpp"
#include "chart.hpp"
#include "compact_actions.hpp"
#include "native_report_view.hpp"
#include <QtWidgets>
#include <cmath>
using namespace quantPlugin;
namespace {
QString day(QJsonValue value){return value.toString().left(10);}
QColor color(const QJsonObject& o){QColor c(o["color"].toString());return c.isValid()?c:QColor("#579dd9");}
void clearLayout(QLayout* l){while(auto* item=l->takeAt(0)){if(item->widget())delete item->widget();if(item->layout())clearLayout(item->layout());delete item;}}
QJsonObject checkedView(const QJsonObject& result){
  const auto view=result["view"].toObject();require(view["schema"]=="webstock.chart-view.v1","此插件未提供兼容的图表视图");
  require(view["metrics"].toArray().size()<=6&&view["lines"].toArray().size()<=16&&view["markers"].toArray().size()<=20000&&view["plots"].toArray().size()<=4,"图表视图超过限制");
  for(auto v:view["lines"].toArray()){auto line=v.toObject();require(line["points"].toArray().size()<=100000,"图层点数超过限制");for(auto point:line["points"].toArray()){auto p=point.toArray();require(p.size()==2&&QDate::fromString(day(p[0]),Qt::ISODate).isValid()&&(p[1].isNull()||(p[1].isDouble()&&std::isfinite(p[1].toDouble()))),"图层坐标无效");}}
  for(auto v:view["markers"].toArray()){auto m=v.toObject();require(QDate::fromString(day(m["date"]),Qt::ISODate).isValid()&&m["price"].isDouble()&&std::isfinite(m["price"].toDouble())&&QStringList{"up","down","diamond"}.contains(m["shape"].toString()),"图表标记无效");}
  for(auto v:view["plots"].toArray()){auto plot=v.toObject();require(plot["series"].toArray().size()<=4,"结果曲线超过限制");for(auto s:plot["series"].toArray()){auto points=s.toObject()["points"].toArray();require(points.size()<=100000,"结果曲线点数超过限制");for(auto p:points){const auto row=p.toArray();require(row.size()==2&&QDate::fromString(day(row[0]),Qt::ISODate).isValid()&&row[1].isDouble()&&std::isfinite(row[1].toDouble()),"结果曲线坐标无效");}}}
  return view;
}
}
class ExtensionPlot final:public QWidget {
  QJsonArray series_;
public:
  explicit ExtensionPlot(QJsonArray series,QWidget* parent=nullptr):QWidget(parent),series_(series){setMinimumHeight(155);setSizePolicy(QSizePolicy::Expanding,QSizePolicy::Expanding);}
  void paintEvent(QPaintEvent*)override{
    QPainter p(this);p.setRenderHint(QPainter::Antialiasing);int panes=qMax(1,int(series_.size()));
    for(int k=0;k<series_.size();++k){auto s=series_[k].toObject();auto rows=s["points"].toArray();if(rows.size()<2)continue;
      double lo=INFINITY,hi=-INFINITY;for(auto v:rows){double y=v.toArray()[1].toDouble();lo=qMin(lo,y);hi=qMax(hi,y);}double pad=qMax(.001,(hi-lo)*.1);lo-=pad;hi+=pad;
      QRectF r(78,k*height()/panes+23,qMax(20,width()-95),qMax(16,height()/panes-46));p.setPen(palette().mid().color());p.drawLine(r.bottomLeft(),r.bottomRight());p.setPen(palette().text().color());p.drawText(4,int(r.top())-8,s["name"].toString()+" / "+s["unit"].toString());
      for(int j=0;j<2;++j)p.drawText(QRectF(0,r.top()+j*r.height()-7,72,18),Qt::AlignRight,QString::number(j?lo:hi,'f',s["unit"]=="%"?2:0));
      QPainterPath path;for(int i=0;i<rows.size();++i){QPointF at(r.left()+i*r.width()/(rows.size()-1),r.bottom()-(rows[i].toArray()[1].toDouble()-lo)/(hi-lo)*r.height());if(i)path.lineTo(at);else path.moveTo(at);}p.setPen(QPen(color(s),1.7));p.drawPath(path);
      p.setPen(palette().text().color());p.drawText(QRectF(r.left(),r.bottom()+3,100,18),day(rows.first().toArray()[0]));p.drawText(QRectF(r.right()-100,r.bottom()+3,100,18),Qt::AlignRight,day(rows.last().toArray()[0]));
    }
  }
};
StockExtensionPanel::StockExtensionPanel(QString root,QString id,Chart* chart,QWidget* parent)
 :QWidget(parent),repository_(root),job_(root,this),chart_(chart),id_(id){
  manifest_=repository_.plugin(id_)["manifest"].toObject();setObjectName("stockExtensionPanel");setProperty("pluginId",id_);
  auto layout=new QVBoxLayout(this);layout->setContentsMargins(6,4,6,4);layout->setSpacing(6);
  auto controls=new CompactActions;operations_=new QComboBox;operations_->setObjectName("extensionOperation");
  for(auto v:manifest_["operations"].toArray()){auto o=v.toObject();if(o["inputKind"]=="ohlcv-single-csv")operations_->addItem(o["title"].toString(),o);}
  controls->addWidget(operations_);start_=new QDateEdit;end_=new QDateEdit;start_->setObjectName("extensionStart");end_->setObjectName("extensionEnd");
  for(auto d:{start_,end_}){d->setCalendarPopup(true);d->setDisplayFormat("yyyy-MM-dd");d->setAccessibleName(d==start_?"开始日期":"结束日期");controls->addWidget(d);}
  auto options=new QPushButton("参数");controls->addWidget(options);run_=new QPushButton("运行");run_->setObjectName("extensionRun");controls->addWidget(run_);cancel_=new QPushButton("取消");cancel_->setObjectName("extensionCancel");controls->addWidget(cancel_);
  auto data=new QPushButton("数据与规则");controls->addWidget(data);history_=new QPushButton("历史");controls->addWidget(history_);report_=new QPushButton("原版报告");controls->addWidget(report_);layout->addLayout(controls);
  auto refresh=new QPushButton("刷新行情");refresh->setObjectName("extensionRefreshMarket");controls->addWidget(refresh);connect(refresh,&QPushButton::clicked,this,[this]{status_->setText("由主程序更新行情…");emit refreshRequested();});
  form_=new QWidget;form_->setLayout(new CompactActions);layout->addWidget(form_);form_->hide();options->setCheckable(true);connect(options,&QPushButton::toggled,form_,&QWidget::setVisible);
  auto detailRow=new CompactActions;dataLabel_=new QLabel;dataLabel_->setObjectName("extensionDataSummary");detailRow->addWidget(dataLabel_);lines_=new QCheckBox("策略线");marks_=new QCheckBox("◇信号  ▲买 / ▼卖");lines_->setChecked(true);marks_->setChecked(true);detailRow->addWidget(lines_);detailRow->addWidget(marks_);layout->addLayout(detailRow);legend_=new QLabel;legend_->setTextFormat(Qt::RichText);legend_->setWordWrap(false);detailRow->addWidget(legend_);legend_->hide();
  for(auto box:{lines_,marks_})connect(box,&QCheckBox::toggled,this,[this]{layers();});
  metrics_=new QWidget;metricLayout_=new QVBoxLayout(metrics_);metricLayout_->setContentsMargins(0,0,0,0);layout->addWidget(metrics_);metrics_->hide();
  results_=new QTabWidget;results_->setObjectName("extensionResults");results_->setMinimumHeight(180);results_->setMaximumHeight(180);layout->addWidget(results_);results_->hide();
  inspection_=new QLabel;inspection_->setWordWrap(true);inspection_->hide();layout->addWidget(inspection_);status_=new QLabel;status_->setObjectName("extensionStatus");status_->setWordWrap(true);layout->addWidget(status_);
  connect(operations_,&QComboBox::currentIndexChanged,this,[this]{parameters();clearResult();});
  connect(run_,&QPushButton::clicked,this,[this]{guard([this]{run();});});connect(cancel_,&QPushButton::clicked,this,[this]{job_.cancel();});
  connect(data,&QPushButton::clicked,this,&StockExtensionPanel::showDetails);connect(history_,&QPushButton::clicked,this,&StockExtensionPanel::showHistory);
  connect(report_,&QPushButton::clicked,this,[this]{guard([this]{auto record=job_.reopen(runId_);auto d=new QDialog(this);d->setAttribute(Qt::WA_DeleteOnClose);d->setWindowTitle("原版报告");auto l=new QVBoxLayout(d);l->addWidget(new NativeReportView(nativeReport(record["result"].toObject()["nativeReport"].toObject()),repository_.root()+"/report-profile",d));d->resize(1200,800);d->show();});});
  connect(chart,&Chart::barSelected,this,&StockExtensionPanel::inspect);
  for(auto d:{start_,end_})connect(d,&QDateEdit::dateChanged,this,[this]{if(changing_)return;clearResult();status_->setText("范围已改变，点击运行更新结果");availability();});
  job_.progress=[this](QString){status_->setText("计算中…");};
  job_.changed=[this]{availability();if(!job_.active())guard([this]{completed();});};parameters();availability();
}
StockExtensionPanel::~StockExtensionPanel(){job_.changed={};job_.progress={};job_.cancel();if(chart_)chart_->removeExtensionLayer(id_);}
QJsonObject StockExtensionPanel::operation()const{return operations_->currentData().toJsonObject();}
void StockExtensionPanel::guard(std::function<void()> action){try{action();}catch(const std::exception&e){status_->setText(QString::fromUtf8(e.what()));}availability();}
void StockExtensionPanel::parameters(){
  clearLayout(form_->layout());fields_.clear();auto previous=repository_.plugin(id_)["parametersByOperation"].toObject()[operation()["id"].toString()].toObject();
  for(auto v:operation()["parameters"].toArray()){auto f=v.toObject();const auto id=f["id"].toString();const auto value=previous.contains(id)?previous[id]:f["default"];QWidget* field=nullptr;
    if(f["type"]=="integer"){auto w=new QSpinBox;w->setRange(f["minimum"].toInt(),f["maximum"].toInt());w->setValue(value.toInt());connect(w,&QSpinBox::valueChanged,this,[this]{clearResult();});field=w;}
    else if(f["type"]=="number"){auto w=new QDoubleSpinBox;w->setDecimals(4);w->setRange(f["minimum"].toDouble(),f["maximum"].toDouble());w->setValue(value.toDouble());connect(w,&QDoubleSpinBox::valueChanged,this,[this]{clearResult();});field=w;}
    else if(f["type"]=="choice"){auto w=new QComboBox;for(auto c:f["choices"].toArray())w->addItem(c.toVariant().toString(),c.toVariant());w->setCurrentIndex(w->findData(value.toVariant()));connect(w,&QComboBox::currentIndexChanged,this,[this]{clearResult();});field=w;}
    else {auto w=new QLineEdit(value.toString());w->setMaxLength(f["maxLength"].toInt(512));connect(w,&QLineEdit::textChanged,this,[this]{clearResult();});field=w;}
    field->setObjectName("extensionParameter_"+id);fields_[id]=field;form_->layout()->addWidget(new QLabel(f["label"].toString(f["title"].toString(id))));form_->layout()->addWidget(field);
  }
}
void StockExtensionPanel::clearResult(){result_={};runId_.clear();setProperty("runId",QVariant());metrics_->hide();results_->hide();inspection_->hide();legend_->hide();if(chart_)chart_->removeExtensionLayer(id_);availability();}
void StockExtensionPanel::setContext(const QJsonObject& input){const auto key=extensionInput::identity(input);context_=input;if(key==contextKey_){layers();availability();return;}contextKey_=key;if(job_.active())job_.cancel();clearResult();changing_=true;
  try{auto q=extensionInput::query(input);const auto s=extensionInput::snapshot(input,q);auto n=marketHistory::summary(s,q);start_->setDateRange(QDate::fromString(q["startDate"].toString(),Qt::ISODate),QDate::fromString(q["endDate"].toString(),Qt::ISODate));end_->setDateRange(start_->minimumDate(),start_->maximumDate());start_->setDate(start_->minimumDate());end_->setDate(end_->maximumDate());dataLabel_->setText(QString("本地 %1 根 · %2").arg(n["bars"].toInt()).arg(q["adjustment"]=="forward"?"前复权":"不复权"));status_->setText("复用当前股票行情");}
  catch(const std::exception&e){dataLabel_->setText("等待日 K 数据");status_->setText(QString::fromUtf8(e.what()));}changing_=false;availability();
}
void StockExtensionPanel::availability(){bool valid=false;try{extensionInput::snapshot(context_,extensionInput::query(context_,start_->date().toString(Qt::ISODate),end_->date().toString(Qt::ISODate)));valid=true;}catch(...){}
  const bool busy=job_.active();run_->setEnabled(valid&&!busy&&!repository_.runtimeFor(id_).isEmpty());cancel_->setVisible(busy);form_->setEnabled(!busy);operations_->setEnabled(!busy);start_->setEnabled(!busy);end_->setEnabled(!busy);report_->setVisible(!runId_.isEmpty()&&result_.contains("nativeReport"));
}
void StockExtensionPanel::run(){
  require(chart_&&!chart_->minute&&chart_->bars.size()==size_t(context_["rows"].toArray().size()),"主图已改变，请重新加载行情");
  const auto rows=context_["rows"].toArray();for(int i=0;i<rows.size();++i){const auto r=rows[i].toObject();const auto&b=chart_->bars[size_t(i)];require(chart_->labels.value(i)==r["label"].toString()&&b.open==r["open"].toDouble()&&b.high==r["high"].toDouble()&&b.low==r["low"].toDouble()&&b.close==r["close"].toDouble(),"当前主图与行情输入不一致");}
  runParameters_={};for(auto i=fields_.begin();i!=fields_.end();++i){if(auto w=qobject_cast<QSpinBox*>(i.value()))runParameters_[i.key()]=w->value();else if(auto w=qobject_cast<QDoubleSpinBox*>(i.value()))runParameters_[i.key()]=w->value();else if(auto w=qobject_cast<QComboBox*>(i.value()))runParameters_[i.key()]=QJsonValue::fromVariant(w->currentData());else runParameters_[i.key()]=qobject_cast<QLineEdit*>(i.value())->text();}
  runParameters_=validateParameters(operation(),runParameters_);runQuery_=extensionInput::query(context_,start_->date().toString(Qt::ISODate),end_->date().toString(Qt::ISODate));auto s=extensionInput::snapshot(context_,runQuery_);auto bytes=marketHistory::csv(s,runQuery_);clearResult();runKey_=contextKey_;
  auto dir=repository_.root()+"/data-inputs";require(QDir().mkpath(dir),"无法保存本次输入");auto file=dir+"/"+hash(bytes)+".csv";if(QFileInfo::exists(file))require(read(file)==bytes,"输入快照已改变");else write(file,bytes);
  repository_.rememberParameters(id_,operation()["id"].toString(),runParameters_);status_->setText("使用已有行情计算中…");job_.start(id_,operation()["id"].toString(),file,runParameters_,{{"closedBarsOnly",true},{"adjustment",runQuery_["adjustment"]},{"timezone","Asia/Shanghai"},{"volumeUnit","share"},{"source","tencent-kline"},{"dataset",marketHistory::summary(s,runQuery_)},{"chartContextSha256",runKey_}});
}
void StockExtensionPanel::completed(){auto r=job_.current();if(r.isEmpty()||runKey_!=contextKey_)return;if(r["status"]!="completed"){status_->setText("未完成："+r["message"].toString(r["status"].toString()));return;}auto verified=job_.reopen(r["runId"].toString());result_=verified["result"].toObject();require(result_["dataPolicy"].toObject()["chartContextSha256"]==contextKey_,"结果不属于当前行情");checkedView(result_);runId_=r["runId"].toString();setProperty("runId",runId_);render();status_->setText("已完成 · 历史研究模拟");}
void StockExtensionPanel::render(){auto view=checkedView(result_);clearLayout(metricLayout_);auto metrics=new CompactActions;for(auto v:view["metrics"].toArray()){auto m=v.toObject();auto card=new QFrame;card->setObjectName("extensionMetricCard");card->setMinimumWidth(128);
    card->setStyleSheet("QFrame#extensionMetricCard { border: 1px solid #32445c; border-radius: 5px; background: transparent; } QLabel { background: transparent; } QLabel#extensionMetricValue { font-size: 20px; font-weight: 600; }");
    auto cardLayout=new QVBoxLayout(card);cardLayout->setContentsMargins(10,6,10,6);cardLayout->setSpacing(3);
    auto label=new QLabel(m["label"].toString());label->setTextFormat(Qt::PlainText);cardLayout->addWidget(label);
    auto value=new QLabel(m["value"].toString()+" "+m["unit"].toString());value->setObjectName("extensionMetricValue");value->setTextFormat(Qt::PlainText);cardLayout->addWidget(value);metrics->addWidget(card);}metricLayout_->addLayout(metrics);if(!view["position"].toString().isEmpty()){auto position=new QLabel(view["position"].toString());position->setTextFormat(Qt::PlainText);metricLayout_->addWidget(position);}
  QStringList keys;for(auto v:view["lines"].toArray()){auto line=v.toObject();keys<<QString("<span style='color:%1'>━━ %2</span>").arg(color(line).name(),line["name"].toString().left(128).toHtmlEscaped());}legend_->setText(keys.join("   "));legend_->setVisible(!keys.isEmpty());metrics_->show();
  while(results_->count()){auto w=results_->widget(0);results_->removeTab(0);delete w;}
  for(auto v:view["plots"].toArray()){auto plot=v.toObject();results_->addTab(new ExtensionPlot(plot["series"].toArray()),plot["title"].toString());}
  for(auto v:view["tables"].toArray()){auto spec=v.toObject();auto rows=extensionInput::rows(result_,spec["source"].toString());auto columns=spec["columns"].toArray();auto t=new QTableWidget(rows.size(),columns.size());t->setEditTriggers(QAbstractItemView::NoEditTriggers);t->setSelectionBehavior(QAbstractItemView::SelectRows);t->verticalHeader()->hide();QStringList headers;for(auto c:columns)headers<<c.toObject()["label"].toString();t->setHorizontalHeaderLabels(headers);
    for(int r=0;r<rows.size();++r)for(int c=0;c<columns.size();++c){auto value=rows[r].toObject()[columns[c].toObject()["field"].toString()];auto text=value.isDouble()?QString::number(value.toDouble(),'f',columns[c].toObject()["decimals"].toInt(2)):value.toVariant().toString();auto column=columns[c].toObject();if(column["format"]=="date")text=day(value);auto labels=column["labels"].toObject();if(labels.contains(text))text=labels[text].toString();t->setItem(r,c,new QTableWidgetItem(text));}
    t->horizontalHeader()->setSectionResizeMode(QHeaderView::ResizeToContents);t->horizontalHeader()->setStretchLastSection(true);connect(t,&QTableWidget::cellClicked,this,[this,rows,spec](int row,int){if(!chart_||row>=rows.size())return;auto r=rows[row].toObject();int a=chart_->labels.indexOf(day(r[spec["startDate"].toString()])),b=chart_->labels.indexOf(day(r[spec["endDate"].toString()]));if(a<0)a=b;if(b<0)b=a;if(a<0)return;chart_->visibleCount=qBound(16,b-a+24,int(chart_->bars.size()));chart_->endIndex=qMin(int(chart_->bars.size()),b+12);chart_->selected=b;chart_->update();emit chart_->barSelected(b);});results_->addTab(t,spec["title"].toString());}
  results_->setVisible(results_->count()>0);layers();availability();
}
void StockExtensionPanel::layers(){if(!chart_)return;chart_->removeExtensionLayer(id_);if(result_.isEmpty()||isHidden())return;const auto view=result_["view"].toObject();chartExtension::Layer layer;
  if(lines_->isChecked())for(auto v:view["lines"].toArray()){auto o=v.toObject();chartExtension::Line line;line.name=o["name"].toString();line.color=color(o);for(auto p:o["points"].toArray()){auto r=p.toArray();int i=chart_->labels.indexOf(day(r[0]));if(i>=0&&r[1].isDouble())line.points.append({double(i),r[1].toDouble()});}layer.lines.append(line);}
  if(marks_->isChecked())for(auto v:view["markers"].toArray()){auto m=v.toObject();int i=chart_->labels.indexOf(day(m["date"]));if(i>=0)layer.markers.append({i,m["price"].toDouble(),m["shape"].toString(),m["text"].toString(),m["category"].toString(),color(m)});}
  chart_->setExtensionLayer(id_,layer);
}
void StockExtensionPanel::inspect(int index){if(!chart_||result_.isEmpty())return;QStringList notes;for(auto v:result_["view"].toObject()["markers"].toArray()){auto m=v.toObject();if(day(m["date"])==chart_->labels.value(index))notes<<m["text"].toString();}inspection_->setText(notes.join(" · "));inspection_->setVisible(!notes.isEmpty());}
void StockExtensionPanel::showDetails(){auto d=new QDialog(this);d->setAttribute(Qt::WA_DeleteOnClose);d->setWindowTitle("数据与规则");auto l=new QVBoxLayout(d);auto text=new QTextBrowser;QStringList lines{context_["name"].toString()+" · "+context_["id"].toString(),"数据：主程序行情缓存",context_["meta"].toObject()["source"].toString(),"获取时点："+context_["meta"].toObject()["checkedAt"].toString(),"回测范围："+start_->date().toString(Qt::ISODate)+" 至 "+end_->date().toString(Qt::ISODate),"主图缩放不会改变回测范围。",manifest_["ui"].toObject()["rules"].toString()};for(auto w:result_["warnings"].toArray())lines<<w.toString();text->setPlainText(lines.join("\n\n"));l->addWidget(text);d->resize(620,430);d->show();}
void StockExtensionPanel::showHistory(){guard([this]{auto d=new QDialog(this);d->setAttribute(Qt::WA_DeleteOnClose);d->setWindowTitle("已保存结果");auto l=new QVBoxLayout(d);auto list=new QListWidget;l->addWidget(list);for(auto v:job_.records()){auto r=v.toObject();if(r["pluginId"]!=id_)continue;auto item=new QListWidgetItem(r["createdAt"].toString()+" · "+r["status"].toString(),list);item->setData(Qt::UserRole,r["runId"].toString());}connect(list,&QListWidget::itemDoubleClicked,d,[this,d](QListWidgetItem* item){guard([this,d,item]{auto record=job_.reopen(item->data(Qt::UserRole).toString());auto result=record["result"].toObject();require(record["status"]=="completed","此记录没有完成结果");require(result["dataPolicy"].toObject()["chartContextSha256"]==contextKey_,"该历史属于另一只股票或行情版本，请先返回对应行情");checkedView(result);result_=result;runId_=record["runId"].toString();setProperty("runId",runId_);
    {QSignalBlocker a(start_),b(end_);auto dataset=result["dataPolicy"].toObject()["dataset"].toObject();auto first=QDate::fromString(dataset["requestedStart"].toString(),Qt::ISODate),last=QDate::fromString(dataset["requestedEnd"].toString(),Qt::ISODate);if(first.isValid()&&last.isValid()){start_->setDate(first);end_->setDate(last);}}
    render();status_->setText("已打开保存结果 · 历史研究模拟");d->accept();});});d->resize(620,420);d->show();});}
