#pragma once
#include <QListWidget>
#include <QMouseEvent>
#include <QApplication>
#include <QPersistentModelIndex>
class ComparisonChoiceList final:public QListWidget {
 bool doubleRelease=false;
 QPersistentModelIndex pressed;
 QPoint pressPosition;
public:using QListWidget::QListWidget;
protected:
 void mousePressEvent(QMouseEvent* e)override{pressPosition=e->position().toPoint();pressed=indexAt(pressPosition);QListWidget::mousePressEvent(e);}
 void mouseDoubleClickEvent(QMouseEvent* e)override{doubleRelease=true;QListWidget::mouseDoubleClickEvent(e);}
 void mouseReleaseEvent(QMouseEvent* e)override{
  auto* item=itemAt(e->position().toPoint());const auto prior=item?item->checkState():Qt::Unchecked;
  const bool plain=e->button()==Qt::LeftButton&&e->modifiers()==Qt::NoModifier&&pressed.isValid()&&pressed==indexAt(e->position().toPoint())&&(e->position().toPoint()-pressPosition).manhattanLength()<QApplication::startDragDistance();
  QListWidget::mouseReleaseEvent(e);
  // The native checkbox already toggles itself. Row text should behave the same.
  if(!doubleRelease&&plain&&item&&item->checkState()==prior)item->setCheckState(prior==Qt::Checked?Qt::Unchecked:Qt::Checked);
  doubleRelease=false;
  pressed=QPersistentModelIndex();
 }
};
