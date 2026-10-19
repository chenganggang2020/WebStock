#pragma once
#include <QtWidgets>
#include "paper_automation_runtime.hpp"
#include "request_authorization_widget.hpp"
namespace paperAutomation {
class Page:public QWidget {
public:
 Page(QString file,QString account,Runtime::Host host,QWidget*parent=nullptr,QNetworkAccessManager*fake=nullptr);
 void setActive(bool active);bool isActive()const{return active;}std::function<void()> back;
private:
 Runtime runtime;Runtime::Host host;bool active=false,filling=false,dirty=false;std::unique_ptr<aiKnowledge::Prepared> plan;
 QCheckBox *openingAck,*enabled,*simulation,*nextDay;QLineEdit*schedule;QSpinBox*maxPositions;QDoubleSpinBox*reserve;
 QLabel *summary,*status;QComboBox*records;QPlainTextEdit*reader;QPushButton *initialize,*save,*prepare,*preview,*start,*poll;RequestAuthorizationWidget*authorization;
 void guard(std::function<void()> action);void render();void readRecord();QJsonObject settings(bool initial);bool usable()const;
protected:
 void hideEvent(QHideEvent*event)override;
 bool eventFilter(QObject*watched,QEvent*event)override;
 void showEvent(QShowEvent*event)override;
};
}
