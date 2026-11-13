namespace Aidev.Game
{
    public sealed class Score
    {
        public int Value { get; private set; }

        public void AddPoint()
        {
            Value++;
        }
    }
}
