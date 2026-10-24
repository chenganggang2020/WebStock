#pragma once
#include "appearance.hpp"
#include <QtWidgets>
#include <QJsonArray>
#include <QJsonObject>
#include <cmath>
#include <algorithm>

// One date index and one viewport for price, classified flow, visible and dark models.
class CapitalTimeline final:public QWidget {
 QJsonArray rows;QString metric="mainNet",caption="主力净额",modelCoverage="明暗盘尚无已取得记录";int selected=-1,begin=0,visible=40,dragBegin=0;QPoint dragAt;bool dragging=false,candlesVisible=true;
 QRectF plotRect()const{return QRectF(88,64,std::max(1,width()-108),std::max(1,height()-106));}
 int count()const{return std::min(visible,int(rows.size())-begin);}
 QStringList mainKeys()const{if(metric=="seven")return {"mainNet","superNet","largeNet","mediumNet","smallNet"};if(metric=="all"||metric=="darkPair"||metric=="darkNet"||metric=="visibleNet")return {"mainNet"};return {metric};}
 QString name(const QString& key)const{static const QMap<QString,QString> names{{"mainNet","主力"},{"superNet","超大单"},{"largeNet","大单"},{"mediumNet","中单"},{"smallNet","小单"},{"darkNet","暗盘估算"},{"visibleNet","明盘估算"}};return names.value(key,key);}
 QRectF panelRect(int index)const{const auto box=plotRect();const double priceShare=.66,moneyShare=(1.-priceShare)/2.;const double h=box.height()*(candlesVisible?(index==0?priceShare:moneyShare):.5);const double offset=box.height()*(candlesVisible?(index==0?0.:priceShare+(index-1)*moneyShare):index*.5);return {box.left(),box.top()+offset+20,box.width(),std::max(1.,h-28)};}
 double moneyExtent()const{double extent=0;auto keys=mainKeys();keys<<"visibleNet"<<"darkNet";for(int i=begin;i<begin+count();++i)for(const auto& key:keys){const QJsonValue v=rows[i].toObject().value(key);if(v.isDouble()&&std::isfinite(v.toDouble()))extent=std::max(extent,std::abs(v.toDouble()/10000.));}return extent>0?extent*1.06:1.;}
 QRectF moneyBar(int index,const QString& key,double extent)const{
  if(index<begin||index>=begin+count())return {};const QJsonValue v=rows[index].toObject().value(key);if(!v.isDouble()||!std::isfinite(v.toDouble()))return {};
  const bool model=key=="visibleNet"||key=="darkNet";const auto fields=model?QStringList{key}:mainKeys();const int k=fields.indexOf(key);if(k<0)return {};
  const auto r=panelRect((candlesVisible?1:0)+(model?1:0));const double amount=v.toDouble()/10000.,step=r.width()/std::max(1,count()),group=std::min(step*.8,50.),w=std::max(.5,group/fields.size()-1),h=std::abs(amount)/extent*r.height()/2.;
  const bool upwards=model?key=="visibleNet":amount>=0;
  return {r.left()+(index-begin+.5)*step-group/2.+k*(w+1),upwards?r.center().y()-h:r.center().y(),w,h};
 }
public:
 explicit CapitalTimeline(QWidget* parent=nullptr):QWidget(parent){setObjectName("fundTimeline");setMinimumHeight(400);setMinimumWidth(360);setMouseTracking(true);}
 QJsonArray sourceRows()const{return rows;}
 QPair<int,int> viewport()const{return {begin,count()};}
 QRectF barRect(int index,const QString& key)const{return moneyBar(index,key,moneyExtent());}
 QRectF priceRect()const{return candlesVisible?panelRect(0):QRectF();}
 QString modelCoverageText()const{return modelCoverage;}
 void setRows(const QJsonArray& source){if(rows==source)return;const bool newest=begin+visible>=rows.size();rows=source;selected=-1;if(newest)begin=std::max(0,int(rows.size())-visible);else begin=std::min(begin,std::max(0,int(rows.size())-visible));int days=0;QString first,last;for(auto value:rows){const auto row=value.toObject();if(!row["visibleNet"].isDouble()&&!row["darkNet"].isDouble())continue;if(!days)first=row["label"].toString();last=row["label"].toString();++days;}modelCoverage=days?QString("明暗盘已取得 %1 日：%2 — %3；区间内缺日不补值").arg(days).arg(first,last):QString("明暗盘尚无已取得记录；K线日期不代表资金覆盖");update();}
 void focusModelHistory(){int first=-1,last=-1;for(int i=0;i<rows.size();++i){const auto row=rows[i].toObject();if(!row["visibleNet"].isDouble()&&!row["darkNet"].isDouble())continue;if(first<0)first=i;last=i;}if(first<0)return;visible=std::max(5,std::min(60,last-first+1));begin=std::max(0,last-visible+1);selected=-1;update();}
 void setMetric(QString key,QString title){metric=std::move(key);caption=std::move(title);update();}
 void setCandlesVisible(bool show){candlesVisible=show;update();}
protected:
 void paintEvent(QPaintEvent*)override{
  QPainter p(this);p.setRenderHint(QPainter::Antialiasing);const auto theme=appearance::theme(window()->property("stockTheme").toString().isEmpty()?(palette().base().color().lightness()<128?"graphite":"soft"):window()->property("stockTheme").toString());
  p.fillRect(rect(),theme.bg);p.setPen(theme.text);const auto box=plotRect();
  QString title=QString("同一日期轴 · %1 / %2 点 · ").arg(count()).arg(rows.size())+modelCoverage;
  p.drawText(QRectF(12,4,width()-24,22),Qt::AlignLeft|Qt::AlignVCenter,title);
  QString values="悬停查看同一日期的价格、主力、明盘和暗盘；空缺不补零。";
  if(selected>=0&&selected<rows.size()){const auto row=rows[selected].toObject();values=row["label"].toString();auto price=row["candle"].toObject();if(price["close"].isDouble())values+="  收 "+QString::number(price["close"].toDouble(),'f',2);
   auto fields=mainKeys();fields<<"visibleNet"<<"darkNet";for(const auto& key:fields)values+="  "+name(key)+" "+(row[key].isDouble()?QString::number(row[key].toDouble()/10000.,'f',2):QString("未取得"));
   setToolTip(values+(row["modelReceivedAt"].isString()?"\n模型最后接收："+row["modelReceivedAt"].toString():QString()));}
  p.drawText(QRectF(12,27,width()-24,34),Qt::AlignLeft|Qt::TextWordWrap,values);
  const double step=box.width()/std::max(1,count()),extent=moneyExtent();
  auto frame=[&](int index,QString title){auto r=panelRect(index);p.setPen(theme.muted);p.drawText(QRectF(box.left(),r.top()-20,box.width(),18),title);return r;};
  auto crosshair=[&](const QRectF& r){if(selected>=begin&&selected<begin+count()){p.setPen(QPen(theme.accent,1,Qt::DashLine));double x=box.left()+(selected-begin+.5)*step;p.drawLine(QPointF(x,r.top()),QPointF(x,r.bottom()));}};
  int panel=0;
  if(candlesVisible){auto r=frame(panel++,"日K · 来源原复权口径 · 同日对齐（不是资金单位）");double lo=INFINITY,hi=-INFINITY;
   for(int i=begin;i<begin+count();++i){auto c=rows[i].toObject()["candle"].toObject();if(c["low"].isDouble()&&c["high"].isDouble()){lo=std::min(lo,c["low"].toDouble());hi=std::max(hi,c["high"].toDouble());}}
   if(!std::isfinite(lo)||!std::isfinite(hi))p.drawText(r,Qt::AlignCenter,"该日期范围暂无已核日K；资金图仍可独立查看");
   else{if(hi==lo){hi+=1.;lo-=1.;}auto y=[&](double value){return r.bottom()-(value-lo)/(hi-lo)*r.height();};
    p.drawText(QRectF(0,r.top(),80,18),Qt::AlignRight,QString::number(hi,'f',2));p.drawText(QRectF(0,r.bottom()-18,80,18),Qt::AlignRight,QString::number(lo,'f',2));
    for(int i=begin;i<begin+count();++i){auto c=rows[i].toObject()["candle"].toObject();if(!c["open"].isDouble()||!c["close"].isDouble()||!c["low"].isDouble()||!c["high"].isDouble())continue;
     double x=box.left()+(i-begin+.5)*step,o=c["open"].toDouble(),close=c["close"].toDouble();auto ink=close>=o?theme.up:theme.down;p.setPen(ink);p.setBrush(ink);p.drawLine(QPointF(x,y(c["high"].toDouble())),QPointF(x,y(c["low"].toDouble())));const double w=std::min(step*.65,18.);p.drawRect(QRectF(x-w/2.,std::min(y(o),y(close)),w,std::max(1.,std::abs(y(close)-y(o)))));}
   }crosshair(r);
  }
  auto bars=[&](QStringList fields,QString title,bool mirrored){auto r=frame(panel++,title+" · 万元 · 共用资金刻度");int valid=0;
   for(int i=begin;i<begin+count();++i)for(const auto& key:fields){const QJsonValue value=rows[i].toObject().value(key);if(value.isDouble()&&std::isfinite(value.toDouble()))++valid;}
   const double zero=r.center().y();p.setPen(theme.border);p.drawLine(QPointF(r.left(),zero),QPointF(r.right(),zero));p.setPen(theme.muted);
   p.drawText(QRectF(0,zero-9,80,18),Qt::AlignRight,"0");if(!valid){p.drawText(r,Qt::AlignCenter,"本范围未取得该项记录（不是零）");crosshair(r);return;}
   p.drawText(QRectF(0,r.top(),80,18),Qt::AlignRight,QString::number(extent,'f',0));p.drawText(QRectF(0,r.bottom()-18,80,18),Qt::AlignRight,QString::number(mirrored?extent:-extent,'f',0));
   for(int i=begin;i<begin+count();++i)for(int k=0;k<fields.size();++k){const QJsonValue value=rows[i].toObject().value(fields[k]);if(!value.isDouble()||!std::isfinite(value.toDouble()))continue;
    const auto bar=moneyBar(i,fields[k],extent);auto ink=value.toDouble()>=0?theme.up:theme.down;
    p.setPen(Qt::NoPen);p.setBrush(ink);p.drawRoundedRect(bar,std::min(2.,bar.width()/2.),std::min(2.,bar.height()/2.));}
   crosshair(r);
  };
  QStringList mainLabels;for(auto key:mainKeys())mainLabels<<name(key);bars(mainKeys(),mainLabels.join(" / ")+"分类净额",false);
  bars({"visibleNet","darkNet"},"明盘向上 / 暗盘向下 · 柱长为绝对金额 · 红流入 绿流出 · 来源模型估算",true);
  p.setPen(theme.muted);const int stride=std::max(1,int(std::ceil(100./step)));for(int i=begin;i<begin+count();i+=stride)p.drawText(QRectF(box.left()+(i-begin+.5)*step-54,box.bottom()+9,108,22),Qt::AlignCenter,rows[i].toObject()["label"].toString());
 }
 void wheelEvent(QWheelEvent* e)override{if(rows.isEmpty())return;const bool newest=begin+visible>=rows.size();visible=std::clamp(visible+(e->angleDelta().y()>0?-8:8),5,std::max(5,int(rows.size())));begin=newest?std::max(0,int(rows.size())-visible):std::clamp(begin,0,std::max(0,int(rows.size())-visible));selected=-1;e->accept();update();}
 void mousePressEvent(QMouseEvent* e)override{if(e->button()==Qt::LeftButton&&plotRect().contains(e->position())){dragging=true;dragAt=e->pos();dragBegin=begin;}}
 void mouseReleaseEvent(QMouseEvent*)override{dragging=false;}
 void mouseMoveEvent(QMouseEvent* e)override{const auto box=plotRect();if(dragging)begin=std::clamp(dragBegin-int((e->pos().x()-dragAt.x())/box.width()*visible),0,std::max(0,int(rows.size())-visible));
  selected=box.contains(e->position())&&!rows.isEmpty()?begin+std::clamp(int((e->position().x()-box.left())/box.width()*count()),0,count()-1):-1;update();}
};
