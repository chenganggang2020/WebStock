#pragma once
#include "cffex_disclosure_store.hpp"
#include <QWidget>
#include <functional>
class QDateEdit;class QComboBox;class QTextEdit;class QPushButton;class QTableWidget;class QLabel;class QStackedWidget;class QCheckBox;
namespace cffexDisclosure {
class Page final:public QWidget {
public:
 struct Host{std::function<void(QString,QJsonObject)> fetch;std::function<void(QString)> cancel;std::function<void(QString,QString)> notify;};
 Page(Host,QString file,QWidget*parent=nullptr);~Page()override;
 QString begin(const QString&date,const QString&product);bool accept(const QString&token,const QJsonObject&report);
 void fail(const QString&token,const QString&reason);void cancel();bool save();bool selectHistory(int index);
 void openOriginal();bool back();QJsonObject saveState()const;void restoreState(const QJsonObject&);
 QString activeToken()const{return active;}
private:
 Host host;Store store;QJsonObject archive,current,pending;QJsonArray reports,batch;QString active,batchDate;QStringList remaining;
 QDateEdit*date;QComboBox*product;QComboBox*history;QComboBox*contract;QTextEdit*evidence;QPushButton*saveButton;QPushButton*rawButton;
 QTableWidget*table;QTableWidget*netTable;QLabel*summary;QLabel*citicCard;QLabel*listedCard;QLabel*status;QStackedWidget*stack;QCheckBox*notifyEnabled;QStringList notified;
 void notifyFresh();void requestNext();
 void show(const QJsonObject&);void showReports(const QJsonArray&);void render();void reload();void notice(const QString&);
};
using CffexDisclosurePage=Page;
}
