#pragma once
#include "appearance.hpp"
#include <QStyledItemDelegate>
#include <QTableWidget>
#include <QPainter>
#include <QRegularExpression>
#include <cmath>

namespace financialVisual {
inline double number(const QVariant& value){
 bool ok=false;auto text=value.toString().trimmed();text.remove(',');
 static const QRegularExpression pattern("^([+-]?[0-9]+(?:\\.[0-9]+)?)(%|亿元|万元|亿|万|元|手|点)?$");
 auto m=pattern.match(text);if(!m.hasMatch())return NAN;
 double n=m.captured(1).toDouble(&ok);auto unit=m.captured(2);
 if(unit=="亿"||unit=="亿元")n*=1e8;else if(unit=="万"||unit=="万元")n*=1e4;
 return ok&&std::isfinite(n)?n:NAN;
}
class Delegate final:public QStyledItemDelegate {
 QTableWidget* table;int column;bool bars;mutable bool dirty=true;mutable double maximum=0;
public:
 Delegate(QTableWidget*t,int c,bool drawBars):QStyledItemDelegate(t),table(t),column(c),bars(drawBars){
  auto reset=[this]{dirty=true;};
  connect(t->model(),&QAbstractItemModel::dataChanged,this,reset);
  connect(t->model(),&QAbstractItemModel::modelReset,this,reset);
  connect(t->model(),&QAbstractItemModel::rowsInserted,this,reset);
  connect(t->model(),&QAbstractItemModel::rowsRemoved,this,reset);
 }
 void paint(QPainter*p,const QStyleOptionViewItem&option,const QModelIndex&index)const override{
  auto t=appearance::theme(table->window()->property("stockTheme").toString().isEmpty()?(option.palette.base().color().lightness()<128?"navy":"soft"):table->window()->property("stockTheme").toString());
  const double v=number(index.data());QStyleOptionViewItem opt(option);initStyleOption(&opt,index);
  const auto ink=std::isfinite(v)&&v!=0?(v>0?t.up:t.down):t.text;
  opt.palette.setColor(QPalette::Text,ink);opt.palette.setColor(QPalette::HighlightedText,ink);opt.displayAlignment=Qt::AlignRight|Qt::AlignVCenter;
  if(bars&&std::isfinite(v)){
   if(dirty){maximum=0;for(int row=0;row<index.model()->rowCount();++row){auto n=number(index.sibling(row,column).data());if(std::isfinite(n))maximum=std::max(maximum,std::abs(n));}dirty=false;}
   auto background=opt;background.text.clear();
   // Draw only the style background: QStyledItemDelegate::paint would restore text from the model.
   auto* style=table->style();style->drawPrimitive(QStyle::PE_PanelItemViewItem,&background,p,table);
   auto rect=QRectF(opt.rect).adjusted(6,5,-6,-5);double half=rect.width()/2;
   p->save();p->setClipRect(opt.rect);auto fill=ink;fill.setAlpha(t.dark?65:40);
   if(maximum>0){double w=std::abs(v)/maximum*half;p->fillRect(QRectF(rect.center().x()-(v<0?w:0),rect.top(),w,rect.height()),fill);}
   p->setPen(t.border);p->drawLine(QPointF(rect.center().x(),rect.top()),QPointF(rect.center().x(),rect.bottom()));
   p->setPen(ink);p->drawText(opt.rect.adjusted(6,0,-6,0),opt.displayAlignment,opt.text);p->restore();
  }else {
   // Avoid initStyleOption reapplying stale fixed-color ForegroundRole values.
   table->style()->drawControl(QStyle::CE_ItemViewItem,&opt,p,table);
  }
 }
};
inline void install(QTableWidget*table,std::initializer_list<int>columns,bool bars=true){for(int column:columns)table->setItemDelegateForColumn(column,new Delegate(table,column,bars));}
}
