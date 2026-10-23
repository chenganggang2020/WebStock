#pragma once
#include "business_search_model.hpp"
#include "securities_legacy_store.hpp"
#include <QWidget>
class QTextBrowser;class QLineEdit;class QComboBox;class QTableWidget;class QPlainTextEdit;class QLabel;class QPushButton;
class BusinessSearchPage final:public QWidget {
public:
 struct Sources {
  // Callbacks run on a reader thread: capture paths/values, never widgets.
  std::function<QJsonArray()> directory,profiles;
  std::function<QJsonObject()> stats;
  std::function<QJsonObject(QString)> cachedProfile;
  std::function<SecuritiesLegacyStore::Snapshot()> snapshot;
 };
 using Navigate=std::function<void(QJsonObject,QString)>;
 BusinessSearchPage(QString legacyDatabase,QString profileCache,Navigate,QWidget* parent=nullptr);
 BusinessSearchPage(Sources,Navigate,QWidget* parent=nullptr);
 void reload();void search();QJsonObject selectedRow()const;
 void setSharedQuery(const QString&);
 QJsonObject saveState()const;void restoreState(QJsonObject);
 bool isLoading()const{return busy||pending;}
protected:
 void showEvent(QShowEvent*)override;
 void hideEvent(QHideEvent*)override;
private:
 Sources sources;Navigate navigate;QJsonArray rows,hits;QJsonObject sourceStats;QString error;
 QLineEdit* query;QComboBox *field,*sort;QTableWidget* results;QPlainTextEdit* details;QTextBrowser* summary;QLabel* status;QPushButton *research,*chart,*previous,*next;
 quint64 requestSerial=0,dataSerial=0;
 bool busy=false,pending=false,needsLoad=true;
 int offset=0,rejected=0,supplemental=0;
 QString selectedId;
 void dispatch();void renderResults();
 void renderSelection();void open(QString action);void safe(std::function<void()>);
};
