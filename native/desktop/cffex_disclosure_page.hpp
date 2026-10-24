#pragma once
#include "cffex_disclosure_store.hpp"
#include <QWidget>
#include <functional>
class QDateEdit;class QComboBox;class QTextEdit;class QPushButton;class QTableWidget;class QLabel;class QStackedWidget;
namespace cffexDisclosure {
class Page final:public QWidget {
public:
 struct Host{std::function<void(QString,QJsonObject)> fetch;std::function<void(QString)> cancel;};
 Page(Host,QString file,QWidget*parent=nullptr);~Page()override;
 QString begin(const QString&date,const QString&product);bool accept(const QString&token,const QJsonObject&report);
 void fail(const QString&token,const QString&reason);void cancel();bool save();bool selectHistory(int index);
 void openOriginal();bool back();QJsonObject saveState()const;void restoreState(const QJsonObject&);
 QString activeToken()const{return active;}
private:
 Host host;Store store;QJsonObject archive,current,pending;QString active;
 QDateEdit*date;QComboBox*product;QComboBox*history;QComboBox*contract;QTextEdit*evidence;QPushButton*saveButton;QPushButton*rawButton;
 QTableWidget*table;QLabel*summary;QLabel*status;QStackedWidget*stack;
 void show(const QJsonObject&);void render();void reload();void notice(const QString&);
};
using CffexDisclosurePage=Page;
}
