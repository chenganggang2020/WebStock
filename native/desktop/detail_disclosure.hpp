#pragma once
#include <QBoxLayout>
#include <QToolButton>

inline QToolButton* addDataDetails(QVBoxLayout* layout,QWidget* details,const QString& name){
 auto* button=new QToolButton(layout->parentWidget());button->setText("数据详情");button->setObjectName(name);
 button->setToolButtonStyle(Qt::ToolButtonTextBesideIcon);button->setArrowType(Qt::RightArrow);button->setCheckable(true);
 layout->addWidget(button,0,Qt::AlignLeft);layout->addWidget(details);details->hide();
 QObject::connect(button,&QToolButton::toggled,details,[button,details](bool open){details->setVisible(open);button->setArrowType(open?Qt::DownArrow:Qt::RightArrow);});
 return button;
}
