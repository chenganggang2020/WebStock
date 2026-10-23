#pragma once
#include <QWidget>
#include <QJsonObject>
#include <QStringList>
#include <functional>
#include <memory>
class ArchiveVideoReviewPage : public QWidget {
public:
 using Current=std::function<QJsonObject(QString)>;
 ArchiveVideoReviewPage(QJsonObject captured,QStringList allowedMediaRoots,Current current,QWidget* parent=nullptr);
 ArchiveVideoReviewPage(QJsonObject captured,QStringList allowedMediaRoots,Current current,QWidget* parent,bool compact);
 ~ArchiveVideoReviewPage() override;
 QJsonObject playbackState() const;
 void openMedia(bool playImmediately=false);
 void setActive(bool); void close(); bool back(); QJsonObject saveState(); void restoreState(QJsonObject);
protected:
 void hideEvent(QHideEvent*) override;
private:
 struct State; std::unique_ptr<State> s; void validate(); void release(); bool unchanged(); void seek(double); void renderSegments();
};


