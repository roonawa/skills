using Aidev.Game;
using NUnit.Framework;

namespace Aidev.Tests
{
    public class ScoreTests
    {
        [Test]
        public void AddingOnePointIncreasesScore()
        {
            var score = new Score();
            score.AddPoint();
            Assert.That(score.Value, Is.EqualTo(1));
        }
    }
}
