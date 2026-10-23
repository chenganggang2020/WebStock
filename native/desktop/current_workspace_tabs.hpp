#pragma once
#include <QApplication>
#include <QStyleOptionTabWidgetFrame>
#include <QTabBar>
#include <QTabWidget>
// Window hides the workspace tab bar and navigates through its existing menu.
// Retain all page instances; only the active page participates in shell hints.
class CurrentWorkspaceTabs final:public QTabWidget {
 bool workspaceHints()const{return tabBar()->isHidden()&&!cornerWidget(Qt::TopLeftCorner)&&!cornerWidget(Qt::TopRightCorner);}
 QSize framed(QSize content)const{
  QStyleOptionTabWidgetFrame option;initStyleOption(&option);option.state=QStyle::State_None;
  return style()->sizeFromContents(QStyle::CT_TabWidget,&option,content,this);
 }
 QSize contentHint(bool minimum)const{
  const auto* page=currentWidget();if(!page)return QSize(0,0);
  auto size=minimum?page->minimumSizeHint():page->sizeHint();
  size=size.expandedTo(QSize(0,0));
  if(minimum){
   const auto policy=page->sizePolicy();
   if(policy.horizontalPolicy()==QSizePolicy::Ignored)size.setWidth(0);
   else if(!(policy.horizontalPolicy()&QSizePolicy::ShrinkFlag))size.setWidth(qMax(size.width(),page->sizeHint().width()));
   if(policy.verticalPolicy()==QSizePolicy::Ignored)size.setHeight(0);
   else if(!(policy.verticalPolicy()&QSizePolicy::ShrinkFlag))size.setHeight(qMax(size.height(),page->sizeHint().height()));
   size=size.boundedTo(page->maximumSize());
   if(page->minimumWidth()>0)size.setWidth(page->minimumWidth());
   if(page->minimumHeight()>0)size.setHeight(page->minimumHeight());
   return size;
  }
  return size.expandedTo(page->minimumSize()).boundedTo(page->maximumSize());
 }
public:
 explicit CurrentWorkspaceTabs(QWidget* parent=nullptr):QTabWidget(parent){connect(this,&QTabWidget::currentChanged,this,[this](int){updateGeometry();});}
 // The real workspace has a hidden bar and no corners. For other uses, retain
 // Qt's bar/corner space calculation rather than defining a new tab layout.
 QSize sizeHint()const override{return workspaceHints()?framed(contentHint(false)):QTabWidget::sizeHint();}
 QSize minimumSizeHint()const override{return workspaceHints()?framed(contentHint(true)):QTabWidget::minimumSizeHint();}
 bool hasHeightForWidth()const override{return workspaceHints()?(currentWidget()&&currentWidget()->hasHeightForWidth()):QTabWidget::hasHeightForWidth();}
 int heightForWidth(int width)const override{
  if(!workspaceHints())return QTabWidget::heightForWidth(width);
  const auto* page=currentWidget();if(!page)return minimumSizeHint().height();
  const auto frame=framed(QSize(0,0));
  const int contentWidth=qBound(page->minimumWidth(),qMax(0,width-frame.width()),page->maximumWidth());
  const auto minimum=contentHint(true);
  const int height=page->hasHeightForWidth()?page->heightForWidth(contentWidth):minimum.height();
  return qMin(page->maximumHeight(),qMax(height,minimum.height()))+frame.height();
 }
};
