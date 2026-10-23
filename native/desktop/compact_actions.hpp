#pragma once
#include <QLayout>
#include <QWidget>
#include <algorithm>

// Page actions share one row when space permits; narrow pages wrap whole
// controls, rather than growing the window or hiding a required action.
class CompactActions final : public QLayout {
 QList<QLayoutItem*> items;
 int arrange(const QRect& rect,bool apply)const{
  const auto area=rect.marginsRemoved(contentsMargins());
  int x=area.x(),y=area.y(),rowHeight=0;
  for(auto* item:items){
   if(item->isEmpty())continue;
   auto size=item->sizeHint();size.setWidth(std::min(size.width(),std::max(1,area.width())));
   if(x>area.x()&&x+size.width()>area.right()+1){x=area.x();y+=rowHeight+spacing();rowHeight=0;}
   if(apply)item->setGeometry(QRect(QPoint(x,y),size));
   x+=size.width()+spacing();rowHeight=std::max(rowHeight,size.height());
  }
  return y-area.y()+rowHeight+contentsMargins().top()+contentsMargins().bottom();
 }
public:
 explicit CompactActions(QWidget* owner=nullptr):QLayout(owner){setContentsMargins(0,0,0,0);setSpacing(4);}
 ~CompactActions()override{while(auto* item=takeAt(0))delete item;}
 void addItem(QLayoutItem* item)override{items.append(item);invalidate();}
 void insertWidget(int index,QWidget* widget){addChildWidget(widget);items.insert(std::clamp(index,0,int(items.size())),new QWidgetItem(widget));invalidate();}
 int count()const override{return items.size();}
 QLayoutItem* itemAt(int i)const override{return items.value(i);}
 QLayoutItem* takeAt(int i)override{return i>=0&&i<items.size()?items.takeAt(i):nullptr;}
 Qt::Orientations expandingDirections()const override{return Qt::Horizontal;}
 bool hasHeightForWidth()const override{return true;}
 int heightForWidth(int width)const override{return arrange(QRect(0,0,width,0),false);}
 QSize minimumSize()const override{
  QSize size;for(auto* item:items)if(!item->isEmpty())size=size.expandedTo(item->minimumSize());
  return size+QSize(contentsMargins().left()+contentsMargins().right(),contentsMargins().top()+contentsMargins().bottom());
 }
 QSize sizeHint()const override{return QSize(minimumSize().width(),heightForWidth(1200));}
 void setGeometry(const QRect& rect)override{QLayout::setGeometry(rect);arrange(rect,true);}
 void takeFrom(QLayout* source){
  while(auto* item=source->takeAt(0)){if(auto* widget=item->widget())addWidget(widget);delete item;}
 }
};
