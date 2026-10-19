#pragma once
#include <QWidget>
#include <QPointer>
#include <QTimer>
#include <QEvent>
#include <functional>

// Keep one latest repaint pending; data persistence and explicit user actions are separate.
class VisibleRefresh final:public QObject {
 QPointer<QWidget> page;
 QTimer timer;
 bool dirty=false,delivering=false;
 void schedule(){if(dirty&&page&&page->isVisible()&&!page->window()->isMinimized()&&!timer.isActive())timer.start();}
 protected:
 bool eventFilter(QObject* object,QEvent* event)override{
  if(object==page&&event->type()==QEvent::Hide)timer.stop();
  else if((object==page&&event->type()==QEvent::Show)||event->type()==QEvent::WindowStateChange)request();
  return QObject::eventFilter(object,event);
 }
 public:
 std::function<void()> refresh;
 explicit VisibleRefresh(QWidget* owner):QObject(owner),page(owner),timer(this){
  timer.setSingleShot(true);timer.setInterval(100);owner->installEventFilter(this);if(owner->window()!=owner)owner->window()->installEventFilter(this);
  connect(&timer,&QTimer::timeout,this,[this]{if(!page||!page->isVisible()||page->window()->isMinimized())return;dirty=false;delivering=true;if(refresh)refresh();delivering=false;});
 }
 bool applying()const{return delivering;}
 void request(){dirty=true;schedule();}
};
