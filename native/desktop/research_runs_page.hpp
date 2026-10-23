#pragma once
#include <QWidget>
#include <memory>
#include "business_store.hpp"
class QComboBox;class QLineEdit;class QListWidget;class QPlainTextEdit;class QLabel;class QPushButton;
class ResearchRunsPage : public QWidget {
 std::shared_ptr<BusinessStore> store;
 QComboBox *types,*statuses,*models;QLineEdit* search;QListWidget* list;QPlainTextEdit *reader,*previewReader;QLabel* state;QPushButton *confirm,*cancel,*previous,*next;
 QJsonArray all,filtered,baseline,incoming;int page=0;QString selected;bool filling=false,pending=false;
 void render();void choose(int);void importFile();void exportFile();bool persist();void restore();
public:
 explicit ResearchRunsPage(std::shared_ptr<BusinessStore>,QWidget* parent=nullptr);
 ~ResearchRunsPage() override;
 void reload();void previewImport(const QByteArray&);void confirmImport();void cancelImport();
 QJsonObject saveState() const;void restoreState(const QJsonObject&);
};
