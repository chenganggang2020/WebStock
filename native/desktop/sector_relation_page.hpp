#pragma once
#include "sector_relation_store.hpp"
#include "business_store.hpp"
#include <QWidget>
class QComboBox;class QPlainTextEdit;class QCheckBox;class QLabel;class QTableWidget;class QStackedWidget;class ResearchCompaniesPage;
class SectorRelationPage final:public QWidget {
 SectorRelationStore store;std::shared_ptr<BusinessStore> business;QString reportId;
 QComboBox *topics,*history,*graphRows;QPlainTextEdit *reader,*note;QCheckBox* consent;QLabel* status;QTableWidget* decisions;QStackedWidget* pages;ResearchCompaniesPage* graph=nullptr;QWidget* review;
 QJsonObject pending,viewed;QStringList historyIds;quint64 epoch=0;
 bool live()const;void refreshHistory();void readVersion(const QJsonObject&);void openGraph();void hideEvent(QHideEvent*)override;
public:
 SectorRelationPage(QString report,QString research,std::shared_ptr<BusinessStore>,QWidget* parent=nullptr);
 void cancel();std::function<void()> onBack;
};
