#pragma once
#include "business_store.hpp"
#include <QWidget>
#include <functional>
#include <memory>
class QComboBox;class QLineEdit;class QPlainTextEdit;class QTableWidget;class QLabel;class QPushButton;class IndustryGraph;
class ResearchCompaniesPage final:public QWidget {
public:
 ResearchCompaniesPage(std::shared_ptr<BusinessStore> store,QWidget* parent=nullptr);
 ~ResearchCompaniesPage() override;
 QJsonObject saveState()const;void restoreState(const QJsonObject& state);
 void setTopic(QString id);void reload();std::function<void(QString)> topicChanged;
 void openGraphRelation(QString topic,QString id);
private:
 std::shared_ptr<BusinessStore> store;QComboBox *topics,*stage,*status,*identityDocument;QLineEdit *search,*companyName,*product,*instrument;
 QPlainTextEdit *reader,*identityQuote;QTableWidget* table;QLabel* state;QPushButton* save;IndustryGraph* graph;QJsonArray rows,visible;QJsonObject current,drafts;bool rendering=false,filling=false;
 void render();void select(QString key);void saveCompany();void captureDraft();void persistDrafts();
};
