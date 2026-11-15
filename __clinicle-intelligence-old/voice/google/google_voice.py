"""
google voice service
"""

import time

import speech_recognition
from gtts import gTTS

from bridge.reply import Reply, ReplyType
from common import i18n
from common.log import logger
from common.tmp_dir import TmpDir
from voice.voice import Voice

# speech_recognition wants a BCP-47 locale, gTTS wants a bare language code.
_ASR_LANG = {"ar": "ar-SA", "en": "en-US"}


def _tts_lang():
    return "ar" if i18n.get_language() == "ar" else "en"


class GoogleVoice(Voice):
    recognizer = speech_recognition.Recognizer()

    def __init__(self):
        pass

    def voiceToText(self, voice_file):
        with speech_recognition.AudioFile(voice_file) as source:
            audio = self.recognizer.record(source)
        lang = _ASR_LANG.get(i18n.get_language(), _ASR_LANG["en"])
        try:
            text = self.recognizer.recognize_google(audio, language=lang)
            logger.info("[Google] voiceToText text={} voice file name={}".format(text, voice_file))
            reply = Reply(ReplyType.TEXT, text)
        except speech_recognition.UnknownValueError:
            reply = Reply(ReplyType.ERROR, i18n.t("عذرًا، لم أفهم ما قلته", "Sorry, I couldn't understand that"))
        except speech_recognition.RequestError as e:
            reply = Reply(ReplyType.ERROR, i18n.t(
                "عذرًا، تعذر الاتصال بخدمة Google للتعرف على الصوت؛ {0}",
                "Sorry, could not connect to the Google speech recognition service; {0}",
            ).format(e))
        finally:
            return reply

    def textToVoice(self, text):
        try:
            # Avoid the same filename under multithreading
            mp3File = TmpDir().path() + "reply-" + str(int(time.time())) + "-" + str(hash(text) & 0x7FFFFFFF) + ".mp3"
            tts = gTTS(text=text, lang=_tts_lang())
            tts.save(mp3File)
            logger.info("[Google] textToVoice text={} voice file name={}".format(text, mp3File))
            reply = Reply(ReplyType.VOICE, mp3File)
        except Exception as e:
            reply = Reply(ReplyType.ERROR, str(e))
        finally:
            return reply
