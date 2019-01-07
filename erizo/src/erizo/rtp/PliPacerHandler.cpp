#include "rtp/PliPacerHandler.h"

#include "rtp/RtpUtils.h"
#include "./MediaDefinitions.h"
#include "./MediaStream.h"

namespace erizo {

DEFINE_LOGGER(PliPacerHandler, "rtp.PliPacerHandler");

constexpr duration PliPacerHandler::kMinPLIPeriod;
constexpr duration PliPacerHandler::kKeyframeTimeout;

PliPacerHandler::PliPacerHandler(std::shared_ptr<erizo::Clock> the_clock)
    : enabled_{true}, stream_{nullptr}, clock_{the_clock}, time_last_keyframe_{clock_->now()},
      waiting_for_keyframe_{false}, scheduled_pli_{std::make_shared<ScheduledTaskReference>()},
      video_sink_ssrc_{0}, video_source_ssrc_{0}, fir_seq_number_{0} {}

void PliPacerHandler::enable() {
  ELOG_DEBUG("PliPacerHandler enabled");
  enabled_ = true;
}

void PliPacerHandler::disable() {
  ELOG_DEBUG("PliPacerHandler disabled");
  enabled_ = false;
}

void PliPacerHandler::notifyUpdate() {
  auto pipeline = getContext()->getPipelineShared();
  if (pipeline && !stream_) {
    stream_ = pipeline->getService<MediaStream>().get();
    video_sink_ssrc_ = stream_->getVideoSinkSSRC();
    video_source_ssrc_ = stream_->getVideoSourceSSRC();
  }
}

void PliPacerHandler::read(Context *ctx, std::shared_ptr<DataPacket> packet) {
  if (enabled_ && packet->is_keyframe) {
    ELOG_DEBUG("Received keyframe");
    time_last_keyframe_ = clock_->now();
    waiting_for_keyframe_ = false;
    stream_->getWorker()->unschedule(scheduled_pli_);
    // scheduled_pli_ = std::make_shared<ScheduledTaskReference>();
    std::weak_ptr<PliPacerHandler> weak_this = shared_from_this();
    scheduled_pli_ = stream_->getWorker()->scheduleFromNow([weak_this] {
      if (auto this_ptr = weak_this.lock()) {
        ELOG_DEBUG("PLI Schedule 2 got lock");
        this_ptr->waiting_for_keyframe_ = true;
        this_ptr->scheduleNextPLI();
      } else {
        ELOG_DEBUG("PLI Schedule 2 failed to lock");
      }
    }, kKeyframeTimeout / 2);
  }
  ctx->fireRead(std::move(packet));
}

void PliPacerHandler::sendPLI() {
  ELOG_DEBUG("Sending PLI");
  getContext()->fireWrite(RtpUtils::createPLI(video_source_ssrc_, video_sink_ssrc_));
  scheduleNextPLI();
}

void PliPacerHandler::sendFIR() {
  ELOG_WARN("%s message: Timed out waiting for a keyframe", stream_->toLog());
  getContext()->fireWrite(RtpUtils::createFIR(video_source_ssrc_, video_sink_ssrc_, fir_seq_number_++));
  getContext()->fireWrite(RtpUtils::createFIR(video_source_ssrc_, video_sink_ssrc_, fir_seq_number_++));
  getContext()->fireWrite(RtpUtils::createFIR(video_source_ssrc_, video_sink_ssrc_, fir_seq_number_++));
  waiting_for_keyframe_ = false;
  scheduled_pli_ = std::make_shared<ScheduledTaskReference>();
}

void PliPacerHandler::scheduleNextPLI() {
  if (!waiting_for_keyframe_ || !enabled_) {
    ELOG_DEBUG("PLI Schedule ignored");
    return;
  }
  ELOG_DEBUG("PLI Scheduled");
  std::weak_ptr<PliPacerHandler> weak_this = shared_from_this();
  scheduled_pli_ = stream_->getWorker()->scheduleFromNow([weak_this] {
    if (auto this_ptr = weak_this.lock()) {
      ELOG_DEBUG("PLI Schedule got lock");
      if (this_ptr->clock_->now() - this_ptr->time_last_keyframe_ >= kKeyframeTimeout) {
        this_ptr->sendFIR();
        ELOG_DEBUG("PLI sent FIR");
        return;
      }
      this_ptr->sendPLI();
      ELOG_DEBUG("PLI sent PLI");
    } else {
      ELOG_DEBUG("PLI Schedule failed to lock");
    }
  }, kMinPLIPeriod);
}

void PliPacerHandler::write(Context *ctx, std::shared_ptr<DataPacket> packet) {
  if (enabled_ && RtpUtils::isPLI(packet)) {
    if (waiting_for_keyframe_) {
      return;
    }
    waiting_for_keyframe_ = true;
    scheduleNextPLI();
  }
  ctx->fireWrite(std::move(packet));
}

}  // namespace erizo
