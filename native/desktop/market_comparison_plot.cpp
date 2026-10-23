#include "market_comparison_plot.hpp"
#include "comparison_colors.hpp"
#include <QPainter>
#include <QPainterPath>
#include <QWheelEvent>
#include <QMouseEvent>
#include <QJsonArray>
#include <QToolTip>
#include <cmath>
#include <algorithm>
namespace {QRectF area(const QWidget*w,const QJsonObject&){const int left=std::clamp(w->fontMetrics().horizontalAdvance("-00000000.0000")+12,96,160);return QRectF(left,42,std::max(1,w->width()-left-25),std::max(1,w->height()-124));}QJsonArray labels(QJsonObject f){return f.value(f.contains("dates")?"dates":"labels").toArray();}QColor color(QJsonObject row,int n,const QWidget*w){auto special=row.value("color").toString();if(special=="weighted")return w->palette().text().color();if(special=="leading")return QColor("#db9b1d");if(QColor::isValidColorName(special))return QColor(special);return marketComparison::seriesColor(row["key"].toString(row["name"].toString(QString::number(n))));}}
namespace {
QJsonObject scope(const QJsonObject&f){
 QJsonObject out{{"axis",f.contains("dates")?"dates":"labels"},{"view",f["viewScope"]}};
 if(!f.contains("dates"))out["tradingDate"]=f["tradingDate"];
 return out;
}
int labelIndex(const QJsonArray&items,const QString&key){
 if(key.isEmpty())return -1;int found=-1;
 for(int n=0;n<items.size();++n)if(items[n].toString()==key){if(found>=0)return -1;found=n;}
 return found;
}
QJsonObject timeAnchor(const QJsonObject&f,double index){
 const auto items=labels(f);if(!std::isfinite(index)||index<0||index>=items.size())return {};
 const int n=int(std::floor(index));if(items[n].toString().isEmpty())return {};
 return {{"label",items[n]},{"offset",index-n}};
}
double anchorIndex(const QJsonObject&f,const QJsonObject&anchor){
 const int n=labelIndex(labels(f),anchor["label"].toString());const auto offset=anchor["offset"];
 if(n<0||!offset.isDouble()||!std::isfinite(offset.toDouble())||offset.toDouble()<0||offset.toDouble()>=1)return NAN;
 return n+offset.toDouble();
}
}
MarketComparisonPlot::MarketComparisonPlot(QWidget*p):QWidget(p){setObjectName("comparisonPlot");setMinimumHeight(230);setMouseTracking(true);setFocusPolicy(Qt::StrongFocus);}
QRectF MarketComparisonPlot::plotRect()const{return area(this,frame);}
void MarketComparisonPlot::clamp(){int count=labels(frame).size();span=std::clamp(span,2.,double(std::max(2,count)));first=std::clamp(first,0.,std::max(0.,count-span));}
void MarketComparisonPlot::setFrame(const QJsonObject&value,bool preserve){
 const bool had=!labels(frame).isEmpty(),wasDragging=dragging;const auto saved=saveViewport();
 const auto pressedAnchor=timeAnchor(frame,pressedFirst),oldScope=scope(frame);frame=value;
 if(!preserve){pendingViewport={};autoFit=true;first=0;span=std::max(2,int(labels(frame).size()));clearReadout();}
 else if(labels(frame).isEmpty()){if(had)pendingViewport=saved;first=0;span=2;clearReadout();}
 else if(!pendingViewport.isEmpty()){auto pending=pendingViewport;pendingViewport={};restoreViewport(pending);}
 else if(had)restoreViewport(saved);
 else{first=0;span=std::max(2,int(labels(frame).size()));autoFit=true;clearReadout();}
 const double rebased=anchorIndex(frame,pressedAnchor);
 dragging=wasDragging&&preserve&&oldScope==scope(frame)&&std::isfinite(rebased);
 if(dragging)pressedFirst=rebased;else unsetCursor();
 clamp();update();
}
QJsonObject MarketComparisonPlot::saveViewport()const{
 if(!pendingViewport.isEmpty())return pendingViewport;
 QJsonObject saved{{"version",2},{"first",first},{"span",span},{"autoFit",autoFit}};
 if(!labels(frame).isEmpty())saved["timeAnchors"]=QJsonObject{{"scope",scope(frame)},{"first",timeAnchor(frame,first)},{"last",timeAnchor(frame,first+span-1)},{"hoveredLabel",hovered>=0&&hovered<labels(frame).size()?labels(frame)[hovered].toString():QString()}};
 return saved;
}
void MarketComparisonPlot::restoreViewport(const QJsonObject&value){
 if(!value.value("first").isDouble()||!value.value("span").isDouble()||!std::isfinite(value.value("first").toDouble())||!std::isfinite(value.value("span").toDouble())||value["span"].toDouble()<2)return;
 if(labels(frame).isEmpty()){pendingViewport=value;return;}
 const bool legacy=value["version"].toInt()!=2;
 // Old saves could capture the empty/loading frame's 2-slot clamp. They do not
 // distinguish deliberate zoom from that initialization artifact.
 autoFit=legacy?(value["span"].toDouble()<=3||labels(frame).first().toString().contains(':')||value["span"].toDouble()>=labels(frame).size()):value["autoFit"].toBool();
 first=value["first"].toDouble();span=value["span"].toDouble();hovered=-1;
 const auto anchors=value["timeAnchors"].toObject();
 if(!anchors.isEmpty()){
  if(anchors["scope"].toObject()!=scope(frame))autoFit=true;
  else{
   hovered=labelIndex(labels(frame),anchors["hoveredLabel"].toString());
   if(!autoFit){const double left=anchorIndex(frame,anchors["first"].toObject()),right=anchorIndex(frame,anchors["last"].toObject());
    if(std::isfinite(left)&&std::isfinite(right)&&right-left>=1){first=left;span=right-left+1;}else autoFit=true;
   }
  }
 }
 if(autoFit){first=0;span=std::max(2,int(labels(frame).size()));}
 if(hovered<0)clearReadout();else updateReadout();clamp();update();
}
void MarketComparisonPlot::clearReadout(){hovered=-1;if(readoutActive)QToolTip::hideText();readoutActive=false;}
void MarketComparisonPlot::updateReadout(){
 if(!readoutActive||hovered<0||hovered>=labels(frame).size())return;
 QString text=labels(frame)[hovered].toString().toHtmlEscaped();
 for(auto v:frame.value("series").toArray()){auto row=v.toObject();auto values=row.value("values").toArray();QString value=hovered<values.size()&&values[hovered].isDouble()&&std::isfinite(values[hovered].toDouble())?QString::number(values[hovered].toDouble(),'f',6):QString("缺失");text+="<br><span style=\"color:"+color(row,0,this).name()+"\">■</span> "+row.value("name").toString().toHtmlEscaped()+"："+value;}
 QToolTip::showText(readoutPosition,text,this);
}
void MarketComparisonPlot::resetViewport(){pendingViewport={};autoFit=true;first=0;span=std::max(2,int(labels(frame).size()));dragging=false;unsetCursor();clearReadout();clamp();update();emit viewportChanged();}
void MarketComparisonPlot::paintEvent(QPaintEvent*){QPainter p(this);p.setRenderHint(QPainter::Antialiasing);p.fillRect(rect(),palette().base());auto box=area(this,frame);p.setPen(QPen(palette().mid().color(),.6));p.drawRect(box);for(int i=1;i<4;++i){auto y=box.top()+box.height()*i/4;p.drawLine(QPointF(box.left(),y),QPointF(box.right(),y));}auto dates=labels(frame);auto series=frame.value("series").toArray();auto ink=palette().text().color();p.setPen(ink);if(dates.isEmpty()||series.isEmpty()){p.drawText(box,Qt::AlignCenter|Qt::TextWordWrap,frame.value("emptyReason").toString("请选择至少两个指数或板块"));return;}int from=std::max(0,int(std::floor(first))),to=std::min(int(dates.size())-1,int(std::ceil(first+span-1)));double low=INFINITY,high=-INFINITY;for(auto v:series){auto row=v.toObject();if(row.value("hidden").toBool())continue;auto values=row.value("values").toArray();for(int n=from;n<=to&&n<values.size();++n)if(values[n].isDouble()&&std::isfinite(values[n].toDouble())){low=std::min(low,values[n].toDouble());high=std::max(high,values[n].toDouble());}}if(!std::isfinite(low)||!std::isfinite(high)){p.drawText(box,Qt::AlignCenter,"当前区间暂无数据");return;}double padding=std::max((high-low)*.08,.01);low-=padding;high+=padding;auto point=[&](int n,double value){return QPointF(box.left()+(n-first)/std::max(1.,span-1)*box.width(),box.bottom()-(value-low)/(high-low)*box.height());};const int yTicks=std::clamp(int(box.height()/28)+1,2,5);for(int n=0;n<yTicks;++n){double value=low+(high-low)*n/(yTicks-1);double y=point(from,value).y();p.setPen(QPen(palette().mid().color(),.6));p.drawLine(QPointF(box.left(),y),QPointF(box.right(),y));p.setPen(ink);p.drawText(QRectF(0,y-9,box.left()-8,18),Qt::AlignRight|Qt::AlignVCenter,QString::number(value,'f',2));}p.setPen(ink);const int ticks=box.width()>700?5:3;for(int j=0;j<ticks;++j){int n=from+(to-from)*j/(ticks-1);QString label=dates[n].toString();if(dates.size()==242&&from==0&&to==241&&j==(ticks-1)/2)label="11:30/13:00";double w=std::min(box.width(),double(p.fontMetrics().horizontalAdvance(label)+8));double x=point(n,low).x();p.drawText(QRectF(std::clamp(x-w/2,box.left(),box.right()-w),box.bottom()+7,w,22),Qt::AlignCenter,label);}p.drawText(QRectF(box.left(),3,box.width(),24),Qt::AlignLeft,frame.value("title").toString());p.save();p.setClipRect(box.adjusted(-2,-2,2,2));for(int s=0;s<series.size();++s){auto row=series[s].toObject();if(row.value("hidden").toBool())continue;auto values=row.value("values").toArray();QPainterPath path;bool started=false;for(int n=from;n<=to&&n<values.size();++n){if(!values[n].isDouble()||!std::isfinite(values[n].toDouble())){if(!frame.value("connectGaps").toBool())started=false;continue;}auto at=point(n,values[n].toDouble());if(!started){path.moveTo(at);started=true;}else path.lineTo(at);}p.setPen(QPen(color(row,s,this),row.value("width").toDouble(1.7),row.value("dashed").toBool()?Qt::DashLine:Qt::SolidLine));p.drawPath(path);}if(hovered>=from&&hovered<=to){p.setPen(QPen(ink,.7,Qt::DashLine));auto x=point(hovered,low).x();p.drawLine(QPointF(x,box.top()),QPointF(x,box.bottom()));}p.restore();
 const int columns=std::max(1,int(box.width()/150)),legendCapacity=columns*2;QStringList fullLegend;
 for(auto v:series)fullLegend.append(v.toObject().value("name").toString());setToolTip(fullLegend.join("\n"));
 const double cell=box.width()/columns;
 for(int i=0;i<std::min(legendCapacity,int(series.size()));++i){auto row=series[i].toObject();auto name=row.value("name").toString();
  if(i==legendCapacity-1&&series.size()>legendCapacity)name=QString("+%1 更多（悬停查看）").arg(series.size()-legendCapacity+1);
  p.fillRect(QRectF(box.left()+(i%columns)*cell,box.bottom()+38+(i/columns)*18,10,10),color(row,i,this));p.setPen(ink);p.drawText(QRectF(box.left()+(i%columns)*cell+16,box.bottom()+34+(i/columns)*18,cell-24,18),Qt::AlignLeft|Qt::AlignVCenter,p.fontMetrics().elidedText(name,Qt::ElideRight,int(cell-24)));
 }
}
void MarketComparisonPlot::wheelEvent(QWheelEvent*event){auto box=area(this,frame);if(!box.contains(event->position())||labels(frame).size()<3){event->ignore();return;}autoFit=false;double fraction=std::clamp((event->position().x()-box.left())/box.width(),0.,1.);double anchor=first+fraction*(span-1);span*=event->angleDelta().y()>0?.78:1.28;clamp();first=anchor-fraction*(span-1);clamp();update();emit viewportChanged();event->accept();}
void MarketComparisonPlot::mousePressEvent(QMouseEvent*event){if(event->button()==Qt::LeftButton&&area(this,frame).contains(event->position())){dragging=true;pressed=event->position();pressedFirst=first;setCursor(Qt::ClosedHandCursor);event->accept();}else QWidget::mousePressEvent(event);}
void MarketComparisonPlot::mouseMoveEvent(QMouseEvent*event){auto box=area(this,frame);if(dragging){autoFit=false;first=pressedFirst-(event->position().x()-pressed.x())/box.width()*(span-1);clamp();update();emit viewportChanged();return;}auto dates=labels(frame);if(!box.contains(event->position())||dates.isEmpty()){clearReadout();update();return;}hovered=std::clamp(int(std::round(first+(event->position().x()-box.left())/box.width()*(span-1))),0,int(dates.size())-1);readoutPosition=event->globalPosition().toPoint();readoutActive=true;updateReadout();update();}
void MarketComparisonPlot::mouseReleaseEvent(QMouseEvent*event){if(dragging){dragging=false;unsetCursor();event->accept();}else QWidget::mouseReleaseEvent(event);}
void MarketComparisonPlot::mouseDoubleClickEvent(QMouseEvent*){resetViewport();}
void MarketComparisonPlot::leaveEvent(QEvent*event){if(!dragging){clearReadout();update();}QWidget::leaveEvent(event);}
